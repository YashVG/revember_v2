import Foundation

public protocol ProgressStoring {
    func load() throws -> ProgressRecord
    func save(_ progress: ProgressRecord) throws
}

public struct ProgressFileStore: ProgressStoring {
    public let progressURL: URL

    public init(progressURL: URL = Self.defaultProgressURL) {
        self.progressURL = progressURL
    }

    public static var defaultProgressURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base
            .appendingPathComponent("RevemberV2", isDirectory: true)
            .appendingPathComponent("progress.json")
    }

    public func load() throws -> ProgressRecord {
        guard FileManager.default.fileExists(atPath: progressURL.path) else {
            return ProgressRecord()
        }

        let data = try Data(contentsOf: progressURL)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(ProgressRecord.self, from: data)
    }

    public func save(_ progress: ProgressRecord) throws {
        let directory = progressURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(progress)
        try data.write(to: progressURL, options: [.atomic])
    }
}
