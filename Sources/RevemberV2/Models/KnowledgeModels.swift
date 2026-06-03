import Foundation

public struct KnowledgeTopic: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var summary: String
    public var concepts: [Concept]
    public var gaps: [Gap]
    public var questions: [Question]

    public init(
        id: String,
        title: String,
        summary: String,
        concepts: [Concept],
        gaps: [Gap],
        questions: [Question]
    ) {
        self.id = id
        self.title = title
        self.summary = summary
        self.concepts = concepts
        self.gaps = gaps
        self.questions = questions
    }

    public func concept(withID id: String) -> Concept? {
        concepts.first { $0.id == id }
    }
}

public struct Concept: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var firstPrinciples: String
    public var explanation: String
    public var relatedTerms: [String]
    public var confusableTerms: [String]
    public var gapTags: [String]

    public init(
        id: String,
        title: String,
        firstPrinciples: String,
        explanation: String,
        relatedTerms: [String],
        confusableTerms: [String],
        gapTags: [String]
    ) {
        self.id = id
        self.title = title
        self.firstPrinciples = firstPrinciples
        self.explanation = explanation
        self.relatedTerms = relatedTerms
        self.confusableTerms = confusableTerms
        self.gapTags = gapTags
    }
}

public struct Gap: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var tag: String
    public var description: String
    public var conceptIDs: [String]

    public init(id: String, title: String, tag: String, description: String, conceptIDs: [String]) {
        self.id = id
        self.title = title
        self.tag = tag
        self.description = description
        self.conceptIDs = conceptIDs
    }
}

public struct Question: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var prompt: String
    public var difficulty: QuestionDifficulty
    public var conceptIDs: [String]
    public var gapTags: [String]
    public var choices: [AnswerChoice]
    public var explanation: String

    public init(
        id: String,
        prompt: String,
        difficulty: QuestionDifficulty,
        conceptIDs: [String],
        gapTags: [String],
        choices: [AnswerChoice],
        explanation: String
    ) {
        self.id = id
        self.prompt = prompt
        self.difficulty = difficulty
        self.conceptIDs = conceptIDs
        self.gapTags = gapTags
        self.choices = choices
        self.explanation = explanation
    }

    public var correctChoice: AnswerChoice? {
        choices.first { $0.isCorrect }
    }
}

public enum QuestionDifficulty: String, Codable, CaseIterable, Equatable, Sendable {
    case intro
    case medium
    case hard
}

public struct AnswerChoice: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var text: String
    public var isCorrect: Bool

    public init(id: String, text: String, isCorrect: Bool) {
        self.id = id
        self.text = text
        self.isCorrect = isCorrect
    }
}
