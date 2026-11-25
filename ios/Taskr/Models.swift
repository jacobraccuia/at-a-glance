import Foundation

struct UserAccount: Codable, Identifiable {
    let id: String
    let email: String
    let displayName: String
    let timezone: String
    let isGuest: Bool?
}

struct Bucket: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let color: String?
    let icon: String?
    let sortOrder: Int
    let isDefault: Bool
    let archivedAt: String?
}

enum TaskStatus: String, Codable {
    case captured, active, completed, dropped
}

enum Importance: String, Codable, CaseIterable {
    case low, medium, high
}

enum Effort: String, Codable, CaseIterable {
    case low, medium, high
    var label: String {
        switch self {
        case .low: return "Low"
        case .medium: return "Medium"
        case .high: return "High"
        }
    }
}

struct TaskItem: Codable, Identifiable {
    let id: String
    var title: String
    var notes: String?
    var status: TaskStatus
    var bucketId: String?
    var bucket: Bucket?
    var attentionDate: String?
    var hardDeadline: String?
    var estimateMinutes: Int?
    var importance: Importance
    var effort: Effort?
    var waitingOn: String?
    var recurrenceRuleId: String?
    var snoozedUntil: String?
    var completedAt: String?
    var createdAt: String?
}

enum OccurrenceStatus: String, Codable {
    case pending, completed, skipped
}

struct TaskOccurrence: Codable, Identifiable {
    let id: String
    let taskId: String
    let occurrenceDate: String
    var status: OccurrenceStatus
    var completedAt: String?
    var createdAt: String?
    var task: TaskItem?
}

struct TodayPayload: Codable {
    let tasks: [TaskItem]
    let occurrences: [TaskOccurrence]
}

struct EasyWin: Codable, Identifiable {
    let id: String
    let title: String
    let estimateMinutes: Int?
    let assumedMinutes: Int
}

struct EasyWinsPayload: Codable {
    let minutes: Int
    let wins: [EasyWin]
    let tasks: [TaskItem]?
}

struct ExecutedAction: Decodable, Identifiable {
    var id: String { "\(type)-\(taskId ?? summary)" }
    let type: String
    let ok: Bool
    let summary: String
    let taskId: String?
    let undo: UndoPayload?

    struct UndoPayload: Decodable {
        let kind: String
        let taskId: String
    }

    private enum CodingKeys: String, CodingKey {
        case type, ok, summary, taskId, undo
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "none"
        ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? true
        summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
        taskId = try c.decodeIfPresent(String.self, forKey: .taskId)
        undo = try c.decodeIfPresent(UndoPayload.self, forKey: .undo)
    }
}

struct ChatMessage: Identifiable {
    let id: String
    let role: String
    let content: String
    var actions: [ExecutedAction]?
}

struct ConversationPayload: Decodable {
    let id: String
    let messages: [StoredMessage]

    struct StoredMessage: Decodable, Identifiable {
        let id: String
        let role: String
        let content: String
        let actions: [ExecutedAction]?
    }
}

struct AssistantReply: Decodable {
    let conversationId: String
    let message: ConversationPayload.StoredMessage
    let spoken: String?
    let executed: [ExecutedAction]
}

enum ISO8601 {
    static func date(_ raw: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = withFraction.date(from: raw) { return parsed }
        return ISO8601DateFormatter().date(from: raw)
    }

    static func string(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    static func isToday(_ raw: String?) -> Bool {
        guard let raw, let parsed = date(raw) else { return false }
        return Calendar.current.isDateInToday(parsed)
    }

    /// Calendar time from add to check-off. Nil when either stamp is missing.
    static func doneIn(from start: String?, to end: String?) -> String? {
        guard let start, let end, let a = date(start), let b = date(end) else { return nil }
        let minutes = Int(b.timeIntervalSince(a) / 60)
        guard minutes >= 0 else { return nil }
        if minutes < 1 { return "Done in under a minute" }
        if minutes < 60 { return minutes == 1 ? "Done in 1 minute" : "Done in \(minutes) minutes" }
        let hours = minutes / 60
        if hours < 24 { return hours == 1 ? "Done in 1 hour" : "Done in \(hours) hours" }
        let days = hours / 24
        return days == 1 ? "Done in 1 day" : "Done in \(days) days"
    }
}

enum BoardView: String, CaseIterable, Identifiable {
    case today, tomorrow, nextWeek, later, all
    var id: String { rawValue }
    var label: String {
        switch self {
        case .today: return "Today"
        case .tomorrow: return "Tomorrow"
        case .nextWeek: return "Next week"
        case .later: return "Later"
        case .all: return "All"
        }
    }
    var usesHorizonPayload: Bool { self != .all }
}
