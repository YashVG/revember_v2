import Combine
import Foundation
import UserNotifications

@MainActor
public final class ReviewNotificationService: ObservableObject {
    public static let shared = ReviewNotificationService()

    @Published public private(set) var isEnabled: Bool
    @Published public private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined

    private let center: UNUserNotificationCenter
    private let userDefaults: UserDefaults
    private let enabledKey = "reviewNotificationsEnabled"
    private let notificationIdentifier = "revember.next-review"

    public init(
        center: UNUserNotificationCenter = .current(),
        userDefaults: UserDefaults = .standard
    ) {
        self.center = center
        self.userDefaults = userDefaults
        self.isEnabled = userDefaults.bool(forKey: enabledKey)
    }

    public func refreshAuthorizationStatus() async {
        authorizationStatus = await center.notificationSettings().authorizationStatus
    }

    @discardableResult
    public func setEnabled(_ enabled: Bool) async -> Bool {
        if enabled {
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
                isEnabled = granted
            } catch {
                isEnabled = false
            }
        } else {
            isEnabled = false
            center.removePendingNotificationRequests(withIdentifiers: [notificationIdentifier])
        }
        userDefaults.set(isEnabled, forKey: enabledKey)
        await refreshAuthorizationStatus()
        return isEnabled
    }

    public func scheduleNextReview(dueAt: Date?, dueCount: Int, now: Date = Date()) async {
        center.removePendingNotificationRequests(withIdentifiers: [notificationIdentifier])
        guard isEnabled, let dueAt else { return }

        let content = UNMutableNotificationContent()
        content.title = "Revember review ready"
        switch dueCount {
        case 0: content.body = "Your next scheduled check is ready."
        case 1: content.body = "One check is ready."
        default: content.body = "\(dueCount) checks are ready."
        }
        content.sound = .default

        let fireDate = max(dueAt, now.addingTimeInterval(60))
        let components = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute],
            from: fireDate
        )
        let request = UNNotificationRequest(
            identifier: notificationIdentifier,
            content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        )
        try? await center.add(request)
    }
}
