import Foundation

public protocol KnowledgeLoading {
    func loadTopics(from knowledgeRoot: URL) throws -> [KnowledgeTopic]
}

public struct KnowledgeLoader: KnowledgeLoading {
    public init() {}

    public static var defaultKnowledgeRoot: URL {
        URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Desktop")
            .appendingPathComponent("RevemberKnowledge", isDirectory: true)
    }

    public func loadTopics(from knowledgeRoot: URL) throws -> [KnowledgeTopic] {
        let topicsDirectory = knowledgeRoot.appendingPathComponent("topics", isDirectory: true)
        let fileManager = FileManager.default

        guard fileManager.fileExists(atPath: topicsDirectory.path) else {
            return []
        }

        let files = try fileManager.contentsOfDirectory(
            at: topicsDirectory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        .filter { $0.pathExtension.lowercased() == "json" }
        .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        return try files.map { file in
            do {
                let data = try Data(contentsOf: file)
                return try decoder.decode(KnowledgeTopic.self, from: data)
            } catch {
                throw KnowledgeLoadError.malformedFile(file.lastPathComponent, error)
            }
        }
    }
}

public enum KnowledgeLoadError: LocalizedError, Equatable {
    case malformedFile(String, Error)

    public static func == (lhs: KnowledgeLoadError, rhs: KnowledgeLoadError) -> Bool {
        switch (lhs, rhs) {
        case let (.malformedFile(left, _), .malformedFile(right, _)):
            return left == right
        }
    }

    public var errorDescription: String? {
        switch self {
        case let .malformedFile(fileName, error):
            "Could not read \(fileName): \(error.localizedDescription)"
        }
    }
}
