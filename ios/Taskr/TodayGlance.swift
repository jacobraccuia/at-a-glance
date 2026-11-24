import Foundation
import WidgetKit

/// What the home screen, lock screen, and morning note all read.
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

    static func dayString(_ date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

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
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func publish(tasks: [TaskItem], occurrences: [TaskOccurrence], wins: [EasyWin], accentHex: String) {
        let active = tasks.filter { $0.status == .active }
        let pending = occurrences.filter { $0.status == .pending }
        let titles = (active.map(\.title) + pending.compactMap { $0.task?.title }).prefix(3)
        let win = wins.first
        let glance = TodayGlance(
            day: dayString(),
            count: active.count + pending.count,
            easyTitle: win?.title ?? active.first?.title ?? pending.first?.task?.title,
            easyMinutes: win?.estimateMinutes ?? win?.assumedMinutes ?? active.first?.estimateMinutes,
            easyId: win?.id ?? active.first?.id ?? pending.first?.taskId,
            titles: Array(titles),
            accentHex: accentHex
        )
        glance.save()
        Task { await MorningNudge.reschedule(glance) }
    }

    /// Pull Today so the widget can move even when the list screen is not open.
    static func refresh(api: APIClient, accentHex: String) async {
        SessionShare.persist()
        do {
            let today: TodayPayload = try await api.get("tasks?view=today")
            let easy: EasyWinsPayload = try await api.get("assistant/easy-wins?minutes=25")
            publish(tasks: today.tasks, occurrences: today.occurrences, wins: easy.wins, accentHex: accentHex)
        } catch {
            await MorningNudge.reschedule(read())
        }
    }
}

enum SessionShare {
    static func persist() {
        guard let cookies = HTTPCookieStorage.shared.cookies(for: siteRoot()), !cookies.isEmpty else { return }
        let header = cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        UserDefaults(suiteName: TodayGlance.appGroup)?.set(header, forKey: "cookie")
    }

    static func clear() {
        UserDefaults(suiteName: TodayGlance.appGroup)?.removeObject(forKey: "cookie")
        if let url = TodayGlance.fileURL() { try? FileManager.default.removeItem(at: url) }
        WidgetCenter.shared.reloadAllTimelines()
    }

    private static func siteRoot() -> URL {
        var parts = URLComponents(url: Branding.apiBase, resolvingAgainstBaseURL: false)
        parts?.path = "/"
        return parts?.url ?? Branding.apiBase
    }
}
