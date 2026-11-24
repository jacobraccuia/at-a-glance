import ActivityKit
import Foundation

extension Notification.Name {
    static let taskrTasksChanged = Notification.Name("taskr.tasks.changed")
}

/// Starts and stops the in-progress Lock Screen card. One at a time.
@MainActor
enum TaskActivity {
    static func wire() {
        LiveActivityActions.didChange = {
            NotificationCenter.default.post(name: .taskrTasksChanged, object: nil)
            await TodayGlance.refresh(api: APIClient(), accentHex: TodayGlance.read().accentHex)
        }
    }

    static func isRunning(_ taskId: String) -> Bool {
        Activity<TaskActivityAttributes>.activities.contains { $0.attributes.taskId == taskId }
    }

    @discardableResult
    static func begin(id: String, title: String, minutes: Int?, accentHex: String) async -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
        if Activity<TaskActivityAttributes>.activities.contains(where: { $0.attributes.taskId == id }) {
            return true
        }
        await LiveTaskControls.end(taskId: nil)
        let attributes = TaskActivityAttributes(
            taskId: id,
            title: trimmed,
            estimateMinutes: minutes,
            accentHex: accentHex
        )
        let state = TaskActivityAttributes.ContentState(startedAt: Date())
        let stale = minutes.flatMap { $0 > 0 ? Date().addingTimeInterval(TimeInterval($0 * 60)) : nil }
        do {
            _ = try Activity.request(
                attributes: attributes,
                content: ActivityContent(state: state, staleDate: stale),
                pushType: nil
            )
            return true
        } catch {
            return false
        }
    }

    static func begin(taskId: String, accentHex: String) async -> Bool {
        let task: TaskItem? = try? await APIClient().get("tasks/\(taskId)")
        guard let task else { return false }
        return await begin(id: task.id, title: task.title, minutes: task.estimateMinutes, accentHex: accentHex)
    }

    static func stop(taskId: String?) async {
        await LiveTaskControls.end(taskId: taskId)
    }
}
