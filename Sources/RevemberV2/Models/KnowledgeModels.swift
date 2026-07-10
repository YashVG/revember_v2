import Foundation

public struct KnowledgeTopic: Codable, Identifiable, Equatable, Sendable {
    public static let currentSchemaVersion = 2

    public var schemaVersion: Int
    public var revision: Int
    public var id: String
    public var title: String
    public var summary: String
    public var sources: [KnowledgeSource]
    public var relationships: [KnowledgeRelationship]
    public var concepts: [Concept]
    public var gaps: [Gap]
    public var questions: [Question]

    public init(
        schemaVersion: Int = 2,
        revision: Int = 1,
        id: String,
        title: String,
        summary: String,
        sources: [KnowledgeSource] = [],
        relationships: [KnowledgeRelationship] = [],
        concepts: [Concept],
        gaps: [Gap],
        questions: [Question]
    ) {
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.id = id
        self.title = title
        self.summary = summary
        self.sources = sources
        self.relationships = relationships
        self.concepts = concepts
        self.gaps = gaps
        self.questions = questions
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case revision
        case id
        case title
        case summary
        case sources
        case relationships
        case concepts
        case gaps
        case questions
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        revision = try container.decodeIfPresent(Int.self, forKey: .revision) ?? 0
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        summary = try container.decode(String.self, forKey: .summary)
        sources = try container.decodeIfPresent([KnowledgeSource].self, forKey: .sources) ?? []
        relationships = try container.decodeIfPresent([KnowledgeRelationship].self, forKey: .relationships) ?? []
        concepts = try container.decode([Concept].self, forKey: .concepts)
        gaps = try container.decode([Gap].self, forKey: .gaps)
        questions = try container.decode([Question].self, forKey: .questions)
    }

    public func concept(withID id: String) -> Concept? {
        concepts.first { $0.id == id }
    }

    public func validate(expectedID: String? = nil) throws {
        var issues: [String] = []

        if schemaVersion < 1 || schemaVersion > Self.currentSchemaVersion {
            issues.append(
                "schemaVersion \(schemaVersion) is unsupported; this app supports versions 1...\(Self.currentSchemaVersion)"
            )
        }
        if schemaVersion >= 2, revision < 1 {
            issues.append("schema v2 topics require a positive revision")
        } else if revision < 0 {
            issues.append("revision cannot be negative")
        }
        if let expectedID, id != expectedID {
            issues.append("topic id \"\(id)\" must match file name \"\(expectedID).json\"")
        }

        Self.appendDuplicateIssues(sources.map(\.id), kind: "source", to: &issues)
        Self.appendDuplicateIssues(relationships.map(\.id), kind: "relationship", to: &issues)
        Self.appendDuplicateIssues(concepts.map(\.id), kind: "concept", to: &issues)
        Self.appendDuplicateIssues(gaps.map(\.id), kind: "gap", to: &issues)
        Self.appendDuplicateIssues(questions.map(\.id), kind: "question", to: &issues)

        let sourceIDs = Set(sources.map(\.id))
        let conceptIDs = Set(concepts.map(\.id))

        for concept in concepts {
            Self.appendUnknownSourceIssues(
                concept.sourceRefs,
                owner: "concept \"\(concept.id)\"",
                knownSourceIDs: sourceIDs,
                to: &issues
            )
        }

        for relationship in relationships {
            if conceptIDs.contains(relationship.sourceConceptID) == false {
                issues.append(
                    "relationship \"\(relationship.id)\" references missing source concept \"\(relationship.sourceConceptID)\""
                )
            }
            if conceptIDs.contains(relationship.targetConceptID) == false {
                issues.append(
                    "relationship \"\(relationship.id)\" references missing target concept \"\(relationship.targetConceptID)\""
                )
            }
            Self.appendUnknownSourceIssues(
                relationship.sourceRefs,
                owner: "relationship \"\(relationship.id)\"",
                knownSourceIDs: sourceIDs,
                to: &issues
            )
        }

        for gap in gaps {
            for conceptID in gap.conceptIDs where conceptIDs.contains(conceptID) == false {
                issues.append("gap \"\(gap.id)\" references missing concept \"\(conceptID)\"")
            }
            Self.appendUnknownSourceIssues(
                gap.sourceRefs,
                owner: "gap \"\(gap.id)\"",
                knownSourceIDs: sourceIDs,
                to: &issues
            )
        }

        for question in questions {
            if question.revision < 1 {
                issues.append("question \"\(question.id)\" requires a positive revision")
            }
            for conceptID in question.conceptIDs where conceptIDs.contains(conceptID) == false {
                issues.append("question \"\(question.id)\" references missing concept \"\(conceptID)\"")
            }
            if question.choices.count < 2 {
                issues.append("question \"\(question.id)\" requires at least two choices")
            }
            if question.choices.filter(\.isCorrect).count != 1 {
                issues.append("question \"\(question.id)\" must have exactly one correct choice")
            }
            Self.appendDuplicateIssues(
                question.choices.map(\.id),
                kind: "choice in question \"\(question.id)\"",
                to: &issues
            )
            Self.appendUnknownSourceIssues(
                question.sourceRefs,
                owner: "question \"\(question.id)\"",
                knownSourceIDs: sourceIDs,
                to: &issues
            )
        }

        guard issues.isEmpty else {
            throw KnowledgeTopicValidationError(issues: issues)
        }
    }

    private static func appendDuplicateIssues(
        _ identifiers: [String],
        kind: String,
        to issues: inout [String]
    ) {
        var seen = Set<String>()
        for identifier in identifiers {
            if identifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                issues.append("\(kind) id cannot be empty")
            } else if seen.insert(identifier).inserted == false {
                issues.append("duplicate \(kind) id \"\(identifier)\"")
            }
        }
    }

    private static func appendUnknownSourceIssues(
        _ references: [String],
        owner: String,
        knownSourceIDs: Set<String>,
        to issues: inout [String]
    ) {
        for reference in references where knownSourceIDs.contains(reference) == false {
            issues.append("\(owner) references missing source \"\(reference)\"")
        }
    }
}

public struct KnowledgeTopicValidationError: LocalizedError, Equatable, Sendable {
    public let issues: [String]

    public init(issues: [String]) {
        self.issues = issues
    }

    public var errorDescription: String? {
        "Invalid knowledge topic: \(issues.joined(separator: "; "))"
    }
}

public struct KnowledgeSource: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var kind: String
    public var title: String
    public var locator: String?
    public var fingerprint: String?
    public var capturedAt: Date?

    public init(
        id: String,
        kind: String,
        title: String,
        locator: String? = nil,
        fingerprint: String? = nil,
        capturedAt: Date? = nil
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.locator = locator
        self.fingerprint = fingerprint
        self.capturedAt = capturedAt
    }
}

public struct KnowledgeRelationship: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var sourceConceptID: String
    public var targetConceptID: String
    public var kind: KnowledgeRelationshipKind
    public var rationale: String
    public var sourceRefs: [String]

    public init(
        id: String,
        sourceConceptID: String,
        targetConceptID: String,
        kind: KnowledgeRelationshipKind,
        rationale: String,
        sourceRefs: [String] = []
    ) {
        self.id = id
        self.sourceConceptID = sourceConceptID
        self.targetConceptID = targetConceptID
        self.kind = kind
        self.rationale = rationale
        self.sourceRefs = sourceRefs
    }
}

public enum KnowledgeRelationshipKind: String, Codable, CaseIterable, Equatable, Sendable {
    case prerequisite
    case partOf
    case contrastsWith
    case enables
}

public struct Concept: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var firstPrinciples: String
    public var explanation: String
    public var relatedTerms: [String]
    public var confusableTerms: [String]
    public var gapTags: [String]
    public var sourceRefs: [String]

    public init(
        id: String,
        title: String,
        firstPrinciples: String,
        explanation: String,
        relatedTerms: [String],
        confusableTerms: [String],
        gapTags: [String],
        sourceRefs: [String] = []
    ) {
        self.id = id
        self.title = title
        self.firstPrinciples = firstPrinciples
        self.explanation = explanation
        self.relatedTerms = relatedTerms
        self.confusableTerms = confusableTerms
        self.gapTags = gapTags
        self.sourceRefs = sourceRefs
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case firstPrinciples
        case explanation
        case relatedTerms
        case confusableTerms
        case gapTags
        case sourceRefs
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        firstPrinciples = try container.decode(String.self, forKey: .firstPrinciples)
        explanation = try container.decode(String.self, forKey: .explanation)
        relatedTerms = try container.decodeIfPresent([String].self, forKey: .relatedTerms) ?? []
        confusableTerms = try container.decodeIfPresent([String].self, forKey: .confusableTerms) ?? []
        gapTags = try container.decodeIfPresent([String].self, forKey: .gapTags) ?? []
        sourceRefs = try container.decodeIfPresent([String].self, forKey: .sourceRefs) ?? []
    }
}

public struct Gap: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var tag: String
    public var description: String
    public var conceptIDs: [String]
    public var misconceptionIDs: [String]
    public var sourceRefs: [String]

    public init(
        id: String,
        title: String,
        tag: String,
        description: String,
        conceptIDs: [String],
        misconceptionIDs: [String] = [],
        sourceRefs: [String] = []
    ) {
        self.id = id
        self.title = title
        self.tag = tag
        self.description = description
        self.conceptIDs = conceptIDs
        self.misconceptionIDs = misconceptionIDs
        self.sourceRefs = sourceRefs
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case tag
        case description
        case conceptIDs
        case misconceptionIDs
        case sourceRefs
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        tag = try container.decode(String.self, forKey: .tag)
        description = try container.decode(String.self, forKey: .description)
        conceptIDs = try container.decodeIfPresent([String].self, forKey: .conceptIDs) ?? []
        misconceptionIDs = try container.decodeIfPresent([String].self, forKey: .misconceptionIDs) ?? []
        sourceRefs = try container.decodeIfPresent([String].self, forKey: .sourceRefs) ?? []
    }
}

public struct Question: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var revision: Int
    public var kind: QuestionKind
    public var transferLevel: TransferLevel
    public var prompt: String
    public var difficulty: QuestionDifficulty
    public var conceptIDs: [String]
    public var gapTags: [String]
    public var sourceRefs: [String]
    public var choices: [AnswerChoice]
    public var explanation: String
    public var retiredAt: Date?

    public init(
        id: String,
        revision: Int = 1,
        kind: QuestionKind = .multipleChoice,
        transferLevel: TransferLevel = .recall,
        prompt: String,
        difficulty: QuestionDifficulty,
        conceptIDs: [String],
        gapTags: [String],
        sourceRefs: [String] = [],
        choices: [AnswerChoice],
        explanation: String,
        retiredAt: Date? = nil
    ) {
        self.id = id
        self.revision = revision
        self.kind = kind
        self.transferLevel = transferLevel
        self.prompt = prompt
        self.difficulty = difficulty
        self.conceptIDs = conceptIDs
        self.gapTags = gapTags
        self.sourceRefs = sourceRefs
        self.choices = choices
        self.explanation = explanation
        self.retiredAt = retiredAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case revision
        case kind
        case transferLevel
        case prompt
        case difficulty
        case conceptIDs
        case gapTags
        case sourceRefs
        case choices
        case explanation
        case retiredAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        revision = try container.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        kind = try container.decodeIfPresent(QuestionKind.self, forKey: .kind) ?? .multipleChoice
        transferLevel = try container.decodeIfPresent(TransferLevel.self, forKey: .transferLevel) ?? .recall
        prompt = try container.decode(String.self, forKey: .prompt)
        difficulty = try container.decode(QuestionDifficulty.self, forKey: .difficulty)
        conceptIDs = try container.decode([String].self, forKey: .conceptIDs)
        gapTags = try container.decode([String].self, forKey: .gapTags)
        sourceRefs = try container.decodeIfPresent([String].self, forKey: .sourceRefs) ?? []
        choices = try container.decode([AnswerChoice].self, forKey: .choices)
        explanation = try container.decode(String.self, forKey: .explanation)
        retiredAt = try container.decodeIfPresent(Date.self, forKey: .retiredAt)
    }

    public var correctChoice: AnswerChoice? {
        choices.first { $0.isCorrect }
    }
}

public enum QuestionKind: String, Codable, CaseIterable, Equatable, Sendable {
    case multipleChoice
    case freeRecall
    case explain
    case predict
    case compare
    case trace
    case debug

    public var requiresRecallBeforeChoices: Bool {
        self == .freeRecall
    }
}

public enum TransferLevel: String, Codable, CaseIterable, Equatable, Sendable {
    case recall
    case application
    case transfer
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
    public var rationale: String?
    public var misconceptionID: String?

    public init(
        id: String,
        text: String,
        isCorrect: Bool,
        rationale: String? = nil,
        misconceptionID: String? = nil
    ) {
        self.id = id
        self.text = text
        self.isCorrect = isCorrect
        self.rationale = rationale
        self.misconceptionID = misconceptionID
    }
}
