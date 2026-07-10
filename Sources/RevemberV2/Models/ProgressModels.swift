import Foundation

public enum ReviewRating: String, Codable, CaseIterable, Equatable, Sendable {
    case missed
    case hard
    case good
    case easy

    public var title: String {
        rawValue.capitalized
    }
}

/// An immutable fact about one completed retrieval attempt.
///
/// Events are append-only and uniquely identified so retrying a save cannot count the
/// same answer twice. Scheduling state is derived when the event is applied.
public struct ReviewEvent: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let topicID: String
    public let questionID: String
    public let questionRevision: Int
    public let questionKind: QuestionKind?
    public let transferLevel: TransferLevel?
    public let questionPrompt: String?
    public let choiceID: String
    public let selectedChoiceText: String?
    public let correctChoiceID: String?
    public let correctChoiceText: String?
    public let isCorrect: Bool
    public let rating: ReviewRating
    public let conceptIDs: [String]
    public let gapTags: [String]
    public let misconceptionIDs: [String]
    public let sourceRefs: [String]
    public let reviewedAt: Date

    public init(
        id: UUID = UUID(),
        topicID: String,
        questionID: String,
        questionRevision: Int = 1,
        questionKind: QuestionKind? = nil,
        transferLevel: TransferLevel? = nil,
        questionPrompt: String? = nil,
        choiceID: String,
        selectedChoiceText: String? = nil,
        correctChoiceID: String? = nil,
        correctChoiceText: String? = nil,
        isCorrect: Bool,
        rating: ReviewRating,
        conceptIDs: [String],
        gapTags: [String],
        misconceptionIDs: [String] = [],
        sourceRefs: [String] = [],
        reviewedAt: Date
    ) {
        self.id = id
        self.topicID = topicID
        self.questionID = questionID
        self.questionRevision = questionRevision
        self.questionKind = questionKind
        self.transferLevel = transferLevel
        self.questionPrompt = questionPrompt
        self.choiceID = choiceID
        self.selectedChoiceText = selectedChoiceText
        self.correctChoiceID = correctChoiceID
        self.correctChoiceText = correctChoiceText
        self.isCorrect = isCorrect
        self.rating = rating
        self.conceptIDs = conceptIDs
        self.gapTags = gapTags
        self.misconceptionIDs = misconceptionIDs
        self.sourceRefs = sourceRefs
        self.reviewedAt = reviewedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case topicID
        case questionID
        case questionRevision
        case questionKind
        case transferLevel
        case questionPrompt
        case choiceID
        case selectedChoiceText
        case correctChoiceID
        case correctChoiceText
        case isCorrect
        case rating
        case conceptIDs
        case gapTags
        case misconceptionIDs
        case sourceRefs
        case reviewedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        topicID = try container.decode(String.self, forKey: .topicID)
        questionID = try container.decode(String.self, forKey: .questionID)
        questionRevision = try container.decodeIfPresent(Int.self, forKey: .questionRevision) ?? 1
        questionKind = try container.decodeIfPresent(QuestionKind.self, forKey: .questionKind)
        transferLevel = try container.decodeIfPresent(TransferLevel.self, forKey: .transferLevel)
        questionPrompt = try container.decodeIfPresent(String.self, forKey: .questionPrompt)
        choiceID = try container.decode(String.self, forKey: .choiceID)
        selectedChoiceText = try container.decodeIfPresent(String.self, forKey: .selectedChoiceText)
        correctChoiceID = try container.decodeIfPresent(String.self, forKey: .correctChoiceID)
        correctChoiceText = try container.decodeIfPresent(String.self, forKey: .correctChoiceText)
        isCorrect = try container.decode(Bool.self, forKey: .isCorrect)
        rating = try container.decode(ReviewRating.self, forKey: .rating)
        conceptIDs = try container.decodeIfPresent([String].self, forKey: .conceptIDs) ?? []
        gapTags = try container.decodeIfPresent([String].self, forKey: .gapTags) ?? []
        misconceptionIDs = try container.decodeIfPresent([String].self, forKey: .misconceptionIDs) ?? []
        sourceRefs = try container.decodeIfPresent([String].self, forKey: .sourceRefs) ?? []
        reviewedAt = try container.decode(Date.self, forKey: .reviewedAt)
    }
}

public struct ReviewCardState: Codable, Equatable, Sendable {
    public var schedulerVersion: String
    public var questionRevision: Int
    public var dueAt: Date
    public var intervalDays: Double
    public var stability: Double
    public var difficulty: Double
    public var lastRating: ReviewRating?
    public var lapses: Int
    public var reviews: Int
    public var lastReviewedAt: Date?

    public init(
        schedulerVersion: String = ReviewScheduler.algorithmVersion,
        questionRevision: Int = 1,
        dueAt: Date,
        intervalDays: Double,
        stability: Double,
        difficulty: Double,
        lastRating: ReviewRating? = nil,
        lapses: Int = 0,
        reviews: Int = 0,
        lastReviewedAt: Date? = nil
    ) {
        self.schedulerVersion = schedulerVersion
        self.questionRevision = questionRevision
        self.dueAt = dueAt
        self.intervalDays = intervalDays
        self.stability = stability
        self.difficulty = difficulty
        self.lastRating = lastRating
        self.lapses = lapses
        self.reviews = reviews
        self.lastReviewedAt = lastReviewedAt
    }

    private enum CodingKeys: String, CodingKey {
        case schedulerVersion
        case questionRevision
        case dueAt
        case intervalDays
        case stability
        case difficulty
        case lastRating
        case lapses
        case reviews
        case lastReviewedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schedulerVersion = try container.decodeIfPresent(String.self, forKey: .schedulerVersion)
            ?? ReviewScheduler.algorithmVersion
        questionRevision = try container.decodeIfPresent(Int.self, forKey: .questionRevision) ?? 1
        dueAt = try container.decode(Date.self, forKey: .dueAt)
        intervalDays = try container.decode(Double.self, forKey: .intervalDays)
        stability = try container.decode(Double.self, forKey: .stability)
        difficulty = try container.decode(Double.self, forKey: .difficulty)
        lastRating = try container.decodeIfPresent(ReviewRating.self, forKey: .lastRating)
        lapses = try container.decodeIfPresent(Int.self, forKey: .lapses) ?? 0
        reviews = try container.decodeIfPresent(Int.self, forKey: .reviews) ?? 0
        lastReviewedAt = try container.decodeIfPresent(Date.self, forKey: .lastReviewedAt)
    }
}

public struct ProgressRecord: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 2

    public private(set) var schemaVersion: Int
    public var topics: [String: TopicProgress]
    public var reviewEvents: [ReviewEvent]

    public init(
        schemaVersion: Int = ProgressRecord.currentSchemaVersion,
        topics: [String: TopicProgress] = [:],
        reviewEvents: [ReviewEvent] = []
    ) {
        self.schemaVersion = schemaVersion
        self.topics = topics
        self.reviewEvents = reviewEvents
    }

    @discardableResult
    public mutating func recordAnswer(
        topicID: String,
        question: Question,
        choice: AnswerChoice,
        answeredAt: Date = Date()
    ) -> Bool {
        let isCorrect = choice.isCorrect
        var topic = topics[topicID, default: TopicProgress()]
        topic.recordAnswer(question: question, isCorrect: isCorrect, answeredAt: answeredAt)
        topics[topicID] = topic
        return isCorrect
    }

    /// Applies an event once. Returns `false` when the event ID was already recorded.
    @discardableResult
    public mutating func recordReview(
        _ event: ReviewEvent,
        scheduler: any ReviewScheduling = ReviewScheduler()
    ) -> Bool {
        guard reviewEvents.contains(where: { $0.id == event.id }) == false else {
            return false
        }

        reviewEvents.append(event)
        var topic = topics[event.topicID, default: TopicProgress()]
        topic.recordReview(
            event,
            scheduler: scheduler,
            history: chronologicalEvents(
                forQuestionID: event.questionID,
                topicID: event.topicID,
                questionRevision: event.questionRevision
            )
        )
        topics[event.topicID] = topic
        schemaVersion = Self.currentSchemaVersion
        return true
    }

    public func score(for topicID: String) -> Double {
        guard let topic = topics[topicID] else { return 0 }
        return topic.score
    }

    public func attempts(for topicID: String) -> Int {
        topics[topicID]?.totalAttempts ?? 0
    }

    public func cardState(topicID: String, questionID: String) -> ReviewCardState? {
        topics[topicID]?.reviewCardsByQuestionID[questionID]
    }

    public func events(forTopicID topicID: String) -> [ReviewEvent] {
        reviewEvents.filter { $0.topicID == topicID }
    }

    /// Immutable card history in chronological ledger order. When two events have the
    /// same timestamp, their array order remains the tie-breaker so a replay is stable.
    public func events(
        forQuestionID questionID: String,
        topicID: String,
        questionRevision: Int? = nil
    ) -> [ReviewEvent] {
        chronologicalEvents(
            forQuestionID: questionID,
            topicID: topicID,
            questionRevision: questionRevision
        )
    }

    /// Rebuilds derived card caches from the append-only evidence ledger. This is the
    /// explicit migration seam for a future FSRS scheduler: event history and legacy
    /// aggregates are preserved, while only `reviewCardsByQuestionID` is replaced.
    @discardableResult
    public mutating func rebuildReviewCardStates(
        using scheduler: any ReviewScheduling
    ) -> Int {
        let cardKeys = Set(reviewEvents.map {
            ReviewCardKey(topicID: $0.topicID, questionID: $0.questionID)
        })
        var rebuiltCount = 0

        for key in cardKeys {
            let revisions = reviewEvents
                .filter { $0.topicID == key.topicID && $0.questionID == key.questionID }
                .map(\.questionRevision)
            guard let newestRevision = revisions.max() else { continue }

            let history = chronologicalEvents(
                forQuestionID: key.questionID,
                topicID: key.topicID,
                questionRevision: newestRevision
            )
            guard history.isEmpty == false else { continue }

            var topic = topics[key.topicID, default: TopicProgress()]
            topic.rebuildReviewCardState(
                questionID: key.questionID,
                questionRevision: newestRevision,
                history: history,
                scheduler: scheduler
            )
            topics[key.topicID] = topic
            rebuiltCount += 1
        }

        if rebuiltCount > 0 {
            schemaVersion = Self.currentSchemaVersion
        }
        return rebuiltCount
    }

    public mutating func migrateToCurrentSchema() {
        schemaVersion = Self.currentSchemaVersion
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case topics
        case reviewEvents
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        topics = try container.decodeIfPresent([String: TopicProgress].self, forKey: .topics) ?? [:]
        reviewEvents = try container.decodeIfPresent([ReviewEvent].self, forKey: .reviewEvents) ?? []
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(topics, forKey: .topics)
        try container.encode(reviewEvents, forKey: .reviewEvents)
    }

    private func chronologicalEvents(
        forQuestionID questionID: String,
        topicID: String,
        questionRevision: Int?
    ) -> [ReviewEvent] {
        reviewEvents.enumerated()
            .filter { _, event in
                event.topicID == topicID
                    && event.questionID == questionID
                    && (questionRevision == nil || event.questionRevision == questionRevision)
            }
            .sorted { left, right in
                if left.element.reviewedAt != right.element.reviewedAt {
                    return left.element.reviewedAt < right.element.reviewedAt
                }
                return left.offset < right.offset
            }
            .map(\.element)
    }

    private struct ReviewCardKey: Hashable {
        let topicID: String
        let questionID: String
    }
}

public struct TopicProgress: Codable, Equatable, Sendable {
    public var attemptsByQuestionID: [String: QuestionProgress]
    public var weakConceptIDs: [String: Int]
    public var lastReviewedAt: Date?
    public var reviewCardsByQuestionID: [String: ReviewCardState]

    public init(
        attemptsByQuestionID: [String: QuestionProgress] = [:],
        weakConceptIDs: [String: Int] = [:],
        lastReviewedAt: Date? = nil,
        reviewCardsByQuestionID: [String: ReviewCardState] = [:]
    ) {
        self.attemptsByQuestionID = attemptsByQuestionID
        self.weakConceptIDs = weakConceptIDs
        self.lastReviewedAt = lastReviewedAt
        self.reviewCardsByQuestionID = reviewCardsByQuestionID
    }

    public mutating func recordAnswer(question: Question, isCorrect: Bool, answeredAt: Date) {
        recordAnswer(
            questionID: question.id,
            conceptIDs: question.conceptIDs,
            isCorrect: isCorrect,
            answeredAt: answeredAt
        )
    }

    public mutating func recordReview(_ event: ReviewEvent, scheduler: any ReviewScheduling) {
        recordAnswer(
            questionID: event.questionID,
            conceptIDs: event.conceptIDs,
            isCorrect: event.isCorrect,
            answeredAt: event.reviewedAt
        )
        let previous = reviewCardsByQuestionID[event.questionID]
            .flatMap { $0.questionRevision == event.questionRevision ? $0 : nil }
        var nextState = scheduler.schedule(
            previous: previous,
            rating: event.isCorrect ? event.rating : .missed,
            reviewedAt: event.reviewedAt
        )
        nextState.questionRevision = event.questionRevision
        nextState.schedulerVersion = scheduler.schedulerVersion
        reviewCardsByQuestionID[event.questionID] = nextState
    }

    /// Applies an event once to compatibility aggregates, then derives the card state
    /// from the complete immutable history for that card revision.
    public mutating func recordReview(
        _ event: ReviewEvent,
        scheduler: any ReviewScheduling,
        history: [ReviewEvent]
    ) {
        recordAnswer(
            questionID: event.questionID,
            conceptIDs: event.conceptIDs,
            isCorrect: event.isCorrect,
            answeredAt: event.reviewedAt
        )
        rebuildReviewCardState(
            questionID: event.questionID,
            questionRevision: event.questionRevision,
            history: history,
            scheduler: scheduler
        )
    }

    public mutating func rebuildReviewCardState(
        questionID: String,
        questionRevision: Int,
        history: [ReviewEvent],
        scheduler: any ReviewScheduling
    ) {
        var state: ReviewCardState?
        for event in history where event.questionRevision == questionRevision {
            var nextState = scheduler.schedule(
                previous: state,
                rating: event.isCorrect ? event.rating : .missed,
                reviewedAt: event.reviewedAt
            )
            nextState.questionRevision = questionRevision
            nextState.schedulerVersion = scheduler.schedulerVersion
            state = nextState
        }

        if let state {
            reviewCardsByQuestionID[questionID] = state
        }
    }

    private mutating func recordAnswer(
        questionID: String,
        conceptIDs: [String],
        isCorrect: Bool,
        answeredAt: Date
    ) {
        var progress = attemptsByQuestionID[questionID, default: QuestionProgress()]
        progress.attempts += 1
        if isCorrect {
            progress.correctAttempts += 1
        } else {
            for conceptID in conceptIDs {
                weakConceptIDs[conceptID, default: 0] += 1
            }
        }
        if progress.lastAnsweredAt == nil || progress.lastAnsweredAt! < answeredAt {
            progress.lastAnsweredAt = answeredAt
        }
        attemptsByQuestionID[questionID] = progress
        if lastReviewedAt == nil || lastReviewedAt! < answeredAt {
            lastReviewedAt = answeredAt
        }
    }

    public var totalAttempts: Int {
        attemptsByQuestionID.values.reduce(0) { $0 + $1.attempts }
    }

    public var totalCorrect: Int {
        attemptsByQuestionID.values.reduce(0) { $0 + $1.correctAttempts }
    }

    public var score: Double {
        guard totalAttempts > 0 else { return 0 }
        return Double(totalCorrect) / Double(totalAttempts)
    }

    private enum CodingKeys: String, CodingKey {
        case attemptsByQuestionID
        case weakConceptIDs
        case lastReviewedAt
        case reviewCardsByQuestionID
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        attemptsByQuestionID = try container.decodeIfPresent(
            [String: QuestionProgress].self,
            forKey: .attemptsByQuestionID
        ) ?? [:]
        weakConceptIDs = try container.decodeIfPresent([String: Int].self, forKey: .weakConceptIDs) ?? [:]
        lastReviewedAt = try container.decodeIfPresent(Date.self, forKey: .lastReviewedAt)
        reviewCardsByQuestionID = try container.decodeIfPresent(
            [String: ReviewCardState].self,
            forKey: .reviewCardsByQuestionID
        ) ?? [:]
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(attemptsByQuestionID, forKey: .attemptsByQuestionID)
        try container.encode(weakConceptIDs, forKey: .weakConceptIDs)
        try container.encodeIfPresent(lastReviewedAt, forKey: .lastReviewedAt)
        try container.encode(reviewCardsByQuestionID, forKey: .reviewCardsByQuestionID)
    }
}

public struct QuestionProgress: Codable, Equatable, Sendable {
    public var attempts: Int
    public var correctAttempts: Int
    public var lastAnsweredAt: Date?

    public init(attempts: Int = 0, correctAttempts: Int = 0, lastAnsweredAt: Date? = nil) {
        self.attempts = attempts
        self.correctAttempts = correctAttempts
        self.lastAnsweredAt = lastAnsweredAt
    }
}
