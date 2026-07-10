import Foundation

public protocol ProgressStoring {
    func load() throws -> ProgressRecord
    func save(_ progress: ProgressRecord) throws
}

public enum ProgressStoreError: LocalizedError {
    case unsupportedSchema(Int)
    case corruptProgress(quarantinedAt: URL, underlying: Error)

    public var errorDescription: String? {
        switch self {
        case let .unsupportedSchema(version):
            "This progress file uses newer schema v\(version); this app supports v\(ProgressRecord.currentSchemaVersion)."
        case let .corruptProgress(quarantinedAt, underlying):
            "The progress file was unreadable and moved to \(quarantinedAt.lastPathComponent): \(underlying.localizedDescription)"
        }
    }
}

public struct ProgressFileStore: ProgressStoring {
    public let progressURL: URL

    private let fileManager: FileManager
    private let identifierProvider: @Sendable () -> String

    public init(
        progressURL: URL = Self.defaultProgressURL,
        fileManager: FileManager = .default,
        identifierProvider: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() }
    ) {
        self.progressURL = progressURL
        self.fileManager = fileManager
        self.identifierProvider = identifierProvider
    }

    public static var defaultProgressURL: URL {
        RevemberPaths.defaultProgressURL
    }

    public func load() throws -> ProgressRecord {
        guard fileManager.fileExists(atPath: progressURL.path) else {
            return ProgressRecord()
        }

        let data = try Data(contentsOf: progressURL)
        let declaredVersion = try declaredSchemaVersion(in: data)
        guard declaredVersion <= ProgressRecord.currentSchemaVersion else {
            throw ProgressStoreError.unsupportedSchema(declaredVersion)
        }

        let record: ProgressRecord
        do {
            record = try decoder.decode(ProgressRecord.self, from: data)
        } catch {
            let quarantineURL = artifactURL(kind: "corrupt")
            do {
                try fileManager.moveItem(at: progressURL, to: quarantineURL)
            } catch {
                // If quarantine itself fails, retain the original rather than risking data loss.
                throw error
            }
            throw ProgressStoreError.corruptProgress(quarantinedAt: quarantineURL, underlying: error)
        }

        guard record.schemaVersion < ProgressRecord.currentSchemaVersion else {
            return record
        }

        // Never overwrite a pre-v2 file until a byte-for-byte backup exists beside it.
        let backupURL = artifactURL(kind: "pre-v2-backup")
        try fileManager.copyItem(at: progressURL, to: backupURL)
        var migrated = record
        migrated.migrateToCurrentSchema()
        do {
            try save(migrated)
        } catch {
            // The untouched backup remains available even if the atomic migration write fails.
            throw error
        }
        return migrated
    }

    public func save(_ progress: ProgressRecord) throws {
        let directory = progressURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)

        var current = progress
        current.migrateToCurrentSchema()
        let data = try encoder.encode(current)
        try data.write(to: progressURL, options: [.atomic])
    }

    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }

    private func declaredSchemaVersion(in data: Data) throws -> Int {
        do {
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw DecodingError.dataCorrupted(
                    .init(codingPath: [], debugDescription: "Progress root must be a JSON object.")
                )
            }
            return object["schemaVersion"] as? Int ?? 1
        } catch {
            let quarantineURL = artifactURL(kind: "corrupt")
            do {
                try fileManager.moveItem(at: progressURL, to: quarantineURL)
            } catch {
                throw error
            }
            throw ProgressStoreError.corruptProgress(quarantinedAt: quarantineURL, underlying: error)
        }
    }

    private func artifactURL(kind: String) -> URL {
        let extensionName = progressURL.pathExtension
        let baseName = progressURL.deletingPathExtension().lastPathComponent
        var fileName = "\(baseName).\(kind)-\(identifierProvider())"
        if extensionName.isEmpty == false {
            fileName += ".\(extensionName)"
        }
        return progressURL.deletingLastPathComponent().appendingPathComponent(fileName)
    }
}
