#if canImport(AppIntents)
import AppIntents
import Foundation

public struct RevemberTopicEntity: AppEntity, Identifiable, Sendable {
    public static let typeDisplayRepresentation: TypeDisplayRepresentation = "Revember Topic"
    public static let defaultQuery = RevemberTopicQuery()

    public let id: String
    public let title: String
    public let summary: String

    public init(id: String, title: String, summary: String) {
        self.id = id
        self.title = title
        self.summary = summary
    }

    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(summary)")
    }
}

public struct RevemberTopicQuery: EntityQuery {
    public init() {}

    public func entities(for identifiers: [RevemberTopicEntity.ID]) async throws -> [RevemberTopicEntity] {
        try loadTopics()
            .filter { identifiers.contains($0.id) }
            .map(RevemberTopicEntity.init)
    }

    public func suggestedEntities() async throws -> [RevemberTopicEntity] {
        try loadTopics().map(RevemberTopicEntity.init)
    }

    public func defaultResult() async -> RevemberTopicEntity? {
        try? loadTopics().first.map(RevemberTopicEntity.init)
    }

    private func loadTopics() throws -> [KnowledgeTopic] {
        try KnowledgeLoader().loadTopics(from: RevemberRuntimePaths.currentKnowledgeRoot)
    }
}

private extension RevemberTopicEntity {
    init(_ topic: KnowledgeTopic) {
        self.init(id: topic.id, title: topic.title, summary: topic.summary)
    }
}

public enum ReviewDurationIntentValue: Int, AppEnum {
    case quick = 3
    case standard = 8
    case focused = 15

    public static let typeDisplayRepresentation: TypeDisplayRepresentation = "Review Length"

    public static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .quick: "3 minutes",
        .standard: "8 minutes",
        .focused: "15 minutes"
    ]
}

public struct StartTodayReviewIntent: AppIntent {
    public static let title: LocalizedStringResource = "Start Today's Review"
    public static let description = IntentDescription("Open Revember and begin a review using cards that are due now.")
    public static let openAppWhenRun = true

    @Parameter(title: "Review Length", default: .quick)
    public var duration: ReviewDurationIntentValue

    public init() {}

    public init(duration: ReviewDurationIntentValue) {
        self.duration = duration
    }

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        await AppIntentRouter.shared.enqueue(.startTodayReview(minutes: duration.rawValue))
        return .result(dialog: "Starting a \(duration.rawValue)-minute review.")
    }
}

public struct OpenRevemberTopicIntent: AppIntent {
    public static let title: LocalizedStringResource = "Open Revember Topic"
    public static let description = IntentDescription("Open Revember on a specific topic.")
    public static let openAppWhenRun = true

    @Parameter(title: "Topic")
    public var topic: RevemberTopicEntity

    public init() {}

    public init(topic: RevemberTopicEntity) {
        self.topic = topic
    }

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        await AppIntentRouter.shared.enqueue(.openTopic(id: topic.id))
        return .result(dialog: "Opening \(topic.title).")
    }
}

public struct CaptureLearningCheckpointIntent: AppIntent {
    public static let title: LocalizedStringResource = "Capture Learning Checkpoint"
    public static let description = IntentDescription("Save a local learning checkpoint for a future Revember session.")
    public static let openAppWhenRun = false

    @Parameter(title: "What changed in your understanding?")
    public var summary: String

    @Parameter(title: "Topic")
    public var topic: RevemberTopicEntity?

    @Parameter(title: "Open question")
    public var openQuestion: String?

    public init() {}

    public init(summary: String, topic: RevemberTopicEntity? = nil, openQuestion: String? = nil) {
        self.summary = summary
        self.topic = topic
        self.openQuestion = openQuestion
    }

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        _ = try await LearningSessionCaptureService.shared.captureCheckpoint(
            summary: summary,
            topicID: topic?.id,
            topicTitle: topic?.title,
            openQuestion: openQuestion
        )
        if let topic {
            return .result(dialog: "Saved a checkpoint for \(topic.title).")
        }
        return .result(dialog: "Saved the learning checkpoint locally.")
    }
}

public struct RevemberAppShortcuts: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartTodayReviewIntent(),
            phrases: [
                "Start my review in \(.applicationName)",
                "Review what is due in \(.applicationName)"
            ],
            shortTitle: "Start Review",
            systemImageName: "brain.head.profile"
        )

        AppShortcut(
            intent: OpenRevemberTopicIntent(),
            phrases: [
                "Open a topic in \(.applicationName)",
                "Study a topic with \(.applicationName)"
            ],
            shortTitle: "Open Topic",
            systemImageName: "books.vertical"
        )

        AppShortcut(
            intent: CaptureLearningCheckpointIntent(),
            phrases: [
                "Capture a learning checkpoint in \(.applicationName)",
                "Remember what I learned with \(.applicationName)"
            ],
            shortTitle: "Capture Checkpoint",
            systemImageName: "square.and.pencil"
        )
    }

    public static var shortcutTileColor: ShortcutTileColor { .navy }
}
#endif
