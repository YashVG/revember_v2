import Foundation

public struct ProgressRecord: Codable, Equatable, Sendable {
    public var topics: [String: TopicProgress]

    public init(topics: [String: TopicProgress] = [:]) {
        self.topics = topics
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

    public func score(for topicID: String) -> Double {
        guard let topic = topics[topicID] else { return 0 }
        return topic.score
    }

    public func attempts(for topicID: String) -> Int {
        topics[topicID]?.totalAttempts ?? 0
    }
}

public struct TopicProgress: Codable, Equatable, Sendable {
    public var attemptsByQuestionID: [String: QuestionProgress]
    public var weakConceptIDs: [String: Int]
    public var lastReviewedAt: Date?

    public init(
        attemptsByQuestionID: [String: QuestionProgress] = [:],
        weakConceptIDs: [String: Int] = [:],
        lastReviewedAt: Date? = nil
    ) {
        self.attemptsByQuestionID = attemptsByQuestionID
        self.weakConceptIDs = weakConceptIDs
        self.lastReviewedAt = lastReviewedAt
    }

    public mutating func recordAnswer(question: Question, isCorrect: Bool, answeredAt: Date) {
        var progress = attemptsByQuestionID[question.id, default: QuestionProgress()]
        progress.attempts += 1
        if isCorrect {
            progress.correctAttempts += 1
        } else {
            for conceptID in question.conceptIDs {
                weakConceptIDs[conceptID, default: 0] += 1
            }
        }
        progress.lastAnsweredAt = answeredAt
        attemptsByQuestionID[question.id] = progress
        lastReviewedAt = answeredAt
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
