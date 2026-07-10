import Foundation
import SwiftUI

public enum AppIntentAction: Equatable, Sendable {
    case startTodayReview(minutes: Int)
    case openTopic(id: String)
}

@MainActor
public final class AppIntentRouter: ObservableObject {
    public static let shared = AppIntentRouter()

    @Published public private(set) var pendingAction: AppIntentAction?

    private init() {}

    public func enqueue(_ action: AppIntentAction) {
        pendingAction = action
    }

    public func consume(_ action: AppIntentAction) {
        guard pendingAction == action else { return }
        pendingAction = nil
    }

    public func enqueue(url: URL) {
        guard url.scheme?.lowercased() == "revember" else { return }
        if url.host?.lowercased() == "topic" {
            let topicID = url.pathComponents
                .filter { $0 != "/" }
                .first
                .map { $0.removingPercentEncoding ?? $0 }
            if let topicID, topicID.isEmpty == false {
                enqueue(.openTopic(id: topicID))
            }
        } else if url.host?.lowercased() == "review" {
            let minutes = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first(where: { $0.name == "minutes" })?
                .value
                .flatMap(Int.init) ?? 3
            enqueue(.startTodayReview(minutes: max(1, minutes)))
        }
    }
}
