import Foundation

public struct LearningSessionRecord: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var id: String
    public var revision: Int
    public var capturedAt: Date
    public var title: String
    public var summary: String
    public var topicID: String?
    public var confirmedConceptIDs: [String]
    public var misconceptionIDs: [String]
    public var openQuestions: [String]
    public var sourceRefs: [String]
    public var notesMarkdown: String?

    public init(
        id: String,
        capturedAt: Date,
        title: String,
        summary: String,
        topicID: String? = nil,
        confirmedConceptIDs: [String] = [],
        misconceptionIDs: [String] = [],
        openQuestions: [String] = [],
        sourceRefs: [String] = [],
        notesMarkdown: String? = nil
    ) {
        self.schemaVersion = 1
        self.id = id
        self.revision = 1
        self.capturedAt = capturedAt
        self.title = title
        self.summary = summary
        self.topicID = topicID
        self.confirmedConceptIDs = confirmedConceptIDs
        self.misconceptionIDs = misconceptionIDs
        self.openQuestions = openQuestions
        self.sourceRefs = sourceRefs
        self.notesMarkdown = notesMarkdown
    }
}

public enum RevemberRuntimePaths {
    public static var currentKnowledgeRoot: URL {
        if let configured = RevemberPaths.configuredKnowledgeRoot {
            return configured
        }
        if let persisted = UserDefaults.standard.string(forKey: "knowledgeRootPath"), persisted.isEmpty == false {
            return URL(fileURLWithPath: persisted, isDirectory: true).standardizedFileURL
        }
        return RevemberPaths.defaultKnowledgeRoot
    }
}

public actor LearningSessionCaptureService {
    public static let shared = LearningSessionCaptureService()

    private let fileManager: FileManager

    public init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    @discardableResult
    public func captureCheckpoint(
        summary: String,
        topicID: String?,
        topicTitle: String?,
        openQuestion: String? = nil,
        knowledgeRoot: URL = RevemberRuntimePaths.currentKnowledgeRoot,
        capturedAt: Date = Date()
    ) throws -> URL {
        let trimmedSummary = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedSummary.isEmpty == false else {
            throw LearningSessionCaptureError.emptySummary
        }

        let sessionID = Self.makeSessionID(date: capturedAt)
        let title = topicTitle.map { "\($0) checkpoint" } ?? "Learning checkpoint"
        let trimmedOpenQuestion = openQuestion?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let openQuestions = trimmedOpenQuestion.map { $0.isEmpty ? [] : [$0] } ?? []
        let record = LearningSessionRecord(
            id: sessionID,
            capturedAt: capturedAt,
            title: title,
            summary: trimmedSummary,
            topicID: topicID,
            openQuestions: openQuestions,
            notesMarkdown: "## \(title)\n\n\(trimmedSummary)"
        )

        let sessionsDirectory = knowledgeRoot.appendingPathComponent("sessions", isDirectory: true)
        try fileManager.createDirectory(at: sessionsDirectory, withIntermediateDirectories: true)
        let destination = sessionsDirectory.appendingPathComponent("\(sessionID).json")

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(record)
        try data.write(to: destination, options: Data.WritingOptions.atomic)
        return destination
    }

    private static func makeSessionID(date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let timestamp = formatter.string(from: date)
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: ".", with: "-")
        return "checkpoint-\(timestamp)-\(UUID().uuidString.lowercased())"
    }
}

public enum LearningSessionCaptureError: LocalizedError, Equatable {
    case emptySummary

    public var errorDescription: String? {
        switch self {
        case .emptySummary:
            "A learning checkpoint needs a short summary."
        }
    }
}
