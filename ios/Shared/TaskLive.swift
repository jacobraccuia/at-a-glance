import ActivityKit
import AppIntents
import Foundation

/// Lock Screen card for the one task in progress. The app starts it. It does not auto-start in the morning.
struct TaskActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var startedAt: Date
    }

    var taskId: String
    var title: String
    var estimateMinutes: Int?
    var accentHex: String
}

enum LiveTaskControls {
    static func end(taskId: String?) async {
        for activity in Activity<TaskActivityAttributes>.activities {
            if let taskId, activity.attributes.taskId != taskId { continue }
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// Marks the task done with the shared session cookie, then drops the card.
    static func finish(taskId: String) async -> Bool {
        guard await LiveTaskRemote.complete(taskId) else { return false }
        await end(taskId: taskId)
        await LiveActivityActions.didChange?()
        return true
    }
}

enum LiveActivityActions {
    static var didChange: (() async -> Void)?
}

struct StopLiveTaskIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop"
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        await LiveTaskControls.end(taskId: nil)
        return .result()
    }
}

struct CompleteLiveTaskIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Done"
    static var openAppWhenRun = false

    @Parameter(title: "Task") var taskId: String

    init() { taskId = "" }
    init(taskId: String) { self.taskId = taskId }

    func perform() async throws -> some IntentResult {
        _ = await LiveTaskControls.finish(taskId: taskId)
        return .result()
    }
}

enum LiveTaskRemote {
    static let apiBase = "https://server-production-1374.up.railway.app/api"
    static let appGroup = "group.app.taskr.ios"

    static func complete(_ taskId: String) async -> Bool {
        if await send("POST", "tasks/\(taskId)/complete") { return true }
        guard let occ = await pendingOccurrence(taskId) else { return false }
        return await send("POST", "tasks/\(taskId)/occurrences/\(occ)/complete")
    }

    private static func pendingOccurrence(_ taskId: String) async -> String? {
        guard let data = await fetch("GET", "tasks?view=today") else { return nil }
        struct Payload: Decodable {
            struct Occ: Decodable { let id: String; let taskId: String; let status: String }
            let occurrences: [Occ]
        }
        let payload = try? JSONDecoder().decode(Payload.self, from: data)
        return payload?.occurrences.first { $0.taskId == taskId && $0.status == "pending" }?.id
    }

    private static func send(_ method: String, _ path: String) async -> Bool {
        await fetch(method, path) != nil
    }

    private static func fetch(_ method: String, _ path: String) async -> Data? {
        guard let header = UserDefaults(suiteName: appGroup)?.string(forKey: "cookie"), !header.isEmpty else { return nil }
        guard let url = URL(string: apiBase + "/" + path) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(header, forHTTPHeaderField: "Cookie")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else { return nil }
        return data
    }
}
