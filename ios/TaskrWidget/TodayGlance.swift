import Foundation

/// Same JSON the app writes into the shared group. Keep the fields in step with the app.
struct TodayGlance: Codable {
    var day: String
    var count: Int
    var easyTitle: String?
    var easyMinutes: Int?
    var easyId: String?
    var titles: [String]
    var accentHex: String

    static let appGroup = "group.app.taskr.ios"
    static let empty = TodayGlance(day: "", count: 0, easyTitle: nil, easyMinutes: nil, easyId: nil, titles: [], accentHex: "#2f5bd3")
    /// Same host as the app's Branding.apiBase.
    static let apiBase = "https://server-production-1374.up.railway.app/api"

    static func fileURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent("today-glance.json")
    }

    static func read() -> TodayGlance {
        guard let url = fileURL(),
              let data = try? Data(contentsOf: url),
              let glance = try? JSONDecoder().decode(TodayGlance.self, from: data) else {
            return .empty
        }
        return glance
    }

    func save() {
        guard let url = Self.fileURL(), let data = try? JSONEncoder().encode(self) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func current() async -> TodayGlance {
        if let fresh = await fetch() {
            fresh.save()
            return fresh
        }
        return read()
    }

    private static func fetch() async -> TodayGlance? {
        guard let header = UserDefaults(suiteName: appGroup)?.string(forKey: "cookie"), !header.isEmpty else { return nil }
        async let todayCall = get("tasks?view=today", cookie: header, as: WireToday.self)
        async let easyCall = get("assistant/easy-wins?minutes=25", cookie: header, as: WireEasy.self)
        guard let today = await todayCall else { return nil }
        let easy = await easyCall
        let active = today.tasks.filter { $0.status == "active" }
        let pending = today.occurrences.filter { $0.status == "pending" }
        let titles = (active.map(\.title) + pending.compactMap { $0.task?.title }).prefix(3)
        let win = easy?.wins.first
        let previous = read()
        return TodayGlance(
            day: dayString(),
            count: active.count + pending.count,
            easyTitle: win?.title ?? active.first?.title ?? pending.first?.task?.title,
            easyMinutes: win?.estimateMinutes ?? win?.assumedMinutes ?? active.first?.estimateMinutes,
            easyId: win?.id ?? active.first?.id ?? pending.first?.task?.id,
            titles: Array(titles),
            accentHex: previous.accentHex
        )
    }

    private static func get<T: Decodable>(_ path: String, cookie: String, as type: T.Type) async -> T? {
        guard let url = URL(string: apiBase + "/" + path) else { return nil }
        var request = URLRequest(url: url)
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private static func dayString() -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }
}

private struct WireToday: Decodable {
    let tasks: [WireTask]
    let occurrences: [WireOccurrence]
}

private struct WireTask: Decodable {
    let id: String
    let title: String
    let status: String
    let estimateMinutes: Int?
}

private struct WireOccurrence: Decodable {
    let status: String
    let task: WireTask?
}

private struct WireEasy: Decodable {
    let wins: [WireWin]
}

private struct WireWin: Decodable {
    let id: String
    let title: String
    let estimateMinutes: Int?
    let assumedMinutes: Int
}
