import AppIntents

/// "Add to Tasker." Siri asks for the task, then it lands on Today.
/// Puck and Tasker are the same app name, so this phrase also matches "Add to Puck".
struct AddTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to Tasker"
    static var description = IntentDescription("Add a task without starting a call.")
    static var openAppWhenRun = false

    @Parameter(title: "Task", requestValueDialog: IntentDialog("What's the task?"))
    var task: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let name = task.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            return .result(dialog: "Say the task again.")
        }
        guard await LiveTaskRemote.capture(name) else {
            return .result(dialog: "Open Taskr and sign in, then try again.")
        }
        return .result(dialog: "Added \(name).")
    }
}

/// "Ask Puck", "Talk to Puck", "Tell Puck." Opens the app and starts the live call.
struct TalkToAgentIntent: AppIntent {
    static var title: LocalizedStringResource = "Talk to Puck"
    static var description = IntentDescription("Start a conversation with Puck.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(true, forKey: TalkLaunch.key)
        await MainActor.run {
            NotificationCenter.default.post(name: TalkLaunch.notification, object: nil)
            TalkLaunch.consume()
        }
        return .result()
    }
}

enum TalkLaunch {
    static let key = "taskr.siriTalk"
    static let notification = Notification.Name("taskr.siriTalk")
    @MainActor static weak var model: AppModel?

    @MainActor
    static func consume() {
        guard UserDefaults.standard.bool(forKey: key) else { return }
        guard let model, model.user != nil else { return }
        UserDefaults.standard.set(false, forKey: key)
        model.talkKind = .live
        model.talkOpen = true
    }
}

struct TaskrShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: TalkToAgentIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Talk to \(.applicationName)",
                "Tell \(.applicationName)",
            ],
            shortTitle: "Talk to Puck",
            systemImageName: "waveform"
        )
        AppShortcut(
            intent: AddTaskIntent(),
            phrases: [
                "Add to \(.applicationName)",
            ],
            shortTitle: "Add to Tasker",
            systemImageName: "plus"
        )
    }
}
