import Foundation
import UserNotifications

/// One morning note. Empty days stay quiet. Opening the app before it fires cancels that day.
enum MorningNudge {
    static let enabledKey = "taskr.nudge.enabled"
    static let minutesKey = "taskr.nudge.minutes"
    static let openedDayKey = "taskr.nudge.opened"
    static let requestId = "taskr.morning"
    static let defaultMinutes = 8 * 60 + 30

    static var enabled: Bool {
        get {
            if UserDefaults.standard.object(forKey: enabledKey) == nil { return true }
            return UserDefaults.standard.bool(forKey: enabledKey)
        }
        set { UserDefaults.standard.set(newValue, forKey: enabledKey) }
    }

    static var timeDate: Date {
        let hour = minutesFromMidnight / 60
        let minute = minutesFromMidnight % 60
        return Calendar.current.date(from: DateComponents(hour: hour, minute: minute)) ?? Date()
    }

    static func minutes(from date: Date) -> Int {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return (parts.hour ?? 8) * 60 + (parts.minute ?? 30)
    }

    static var minutesFromMidnight: Int {
        get {
            guard let stored = UserDefaults.standard.object(forKey: minutesKey) as? Int else { return defaultMinutes }
            return min(23 * 60 + 59, max(0, stored))
        }
        set { UserDefaults.standard.set(newValue, forKey: minutesKey) }
    }

    static func markOpened() {
        UserDefaults.standard.set(TodayGlance.dayString(), forKey: openedDayKey)
    }

    static func install(onAction: @escaping (String, String?) -> Void) {
        let center = UNUserNotificationCenter.current()
        let delegate = NudgeDelegate.shared
        delegate.onAction = onAction
        center.delegate = delegate
        let start = UNNotificationAction(identifier: "start", title: "Start that one", options: [.foreground])
        let talk = UNNotificationAction(identifier: "talk", title: "Talk", options: [.foreground])
        let category = UNNotificationCategory(identifier: "morning", actions: [start, talk], intentIdentifiers: [])
        center.setNotificationCategories([category])
    }

    static func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        default:
            return false
        }
    }

    static func reschedule(_ glance: TodayGlance) async {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [requestId])
        guard enabled, glance.count > 0, glance.day == TodayGlance.dayString() || !glance.day.isEmpty else { return }
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        guard let fire = nextFire(openedDay: UserDefaults.standard.string(forKey: openedDayKey)) else { return }

        let content = UNMutableNotificationContent()
        content.title = Branding.appName
        content.body = body(for: glance)
        content.sound = .default
        content.categoryIdentifier = "morning"
        if let easyId = glance.easyId {
            content.userInfo = ["easyId": easyId]
        }
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
        let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
        try? await center.add(UNNotificationRequest(identifier: requestId, content: content, trigger: trigger))
    }

    private static func body(for glance: TodayGlance) -> String {
        guard let easy = glance.easyTitle, !easy.isEmpty else {
            return "\(glance.count) on today."
        }
        if let minutes = glance.easyMinutes {
            return "\(glance.count) today. Easiest is \(easy), about \(minutes) minutes."
        }
        return "\(glance.count) today. Easiest is \(easy)."
    }

    /// Today at the chosen time if it is still ahead and the app has not been opened.
    /// Otherwise tomorrow, still only when there is something on the list.
    private static func nextFire(openedDay: String?) -> Date? {
        let calendar = Calendar.current
        let now = Date()
        let today = TodayGlance.dayString(now)
        let hour = minutesFromMidnight / 60
        let minute = minutesFromMidnight % 60
        var parts = calendar.dateComponents([.year, .month, .day], from: now)
        parts.hour = hour
        parts.minute = minute
        guard var fire = calendar.date(from: parts) else { return nil }
        if openedDay == today || fire <= now {
            guard let next = calendar.date(byAdding: .day, value: 1, to: fire) else { return nil }
            fire = next
        }
        return fire
    }
}

final class NudgeDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NudgeDelegate()
    var onAction: ((String, String?) -> Void)?

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        []
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let easy = response.notification.request.content.userInfo["easyId"] as? String
        let action = response.actionIdentifier
        await MainActor.run {
            onAction?(action, easy)
        }
    }
}
