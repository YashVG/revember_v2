import Foundation

public enum RevemberPaths {
    private static func configuredURL(for environmentKey: String, isDirectory: Bool) -> URL? {
        guard let configured = ProcessInfo.processInfo.environment[environmentKey], configured.isEmpty == false else {
            return nil
        }

        let expanded = (configured as NSString).expandingTildeInPath
        return URL(fileURLWithPath: expanded, isDirectory: isDirectory).standardizedFileURL
    }

    public static var configuredKnowledgeRoot: URL? {
        configuredURL(for: "REVEMBER_KNOWLEDGE_ROOT", isDirectory: true)
    }

    public static var configuredProgressURL: URL? {
        configuredURL(for: "REVEMBER_PROGRESS_PATH", isDirectory: false)
    }

    public static var defaultKnowledgeRoot: URL {
        if let configuredKnowledgeRoot {
            return configuredKnowledgeRoot
        }

        let documentsDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents", isDirectory: true)

        return documentsDirectory
            .appendingPathComponent("RevemberKnowledge", isDirectory: true)
    }

    public static var defaultProgressURL: URL {
        if let configuredProgressURL {
            return configuredProgressURL
        }

        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base
            .appendingPathComponent("RevemberV2", isDirectory: true)
            .appendingPathComponent("progress.json")
    }
}

public protocol KnowledgeLoading {
    func loadTopics(from knowledgeRoot: URL) throws -> [KnowledgeTopic]
}

public struct KnowledgeLoader: KnowledgeLoading {
    public init() {}

    public static var defaultKnowledgeRoot: URL {
        RevemberPaths.defaultKnowledgeRoot
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
                let topic = try decoder.decode(KnowledgeTopic.self, from: data)
                try topic.validate(expectedID: file.deletingPathExtension().lastPathComponent)
                return topic
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
