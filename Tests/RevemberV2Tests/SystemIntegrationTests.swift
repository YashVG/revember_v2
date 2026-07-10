import Foundation
import Testing
@testable import RevemberV2Core

@Suite("System integration")
struct SystemIntegrationTests {
    @Test("learning checkpoint uses the MCP session artifact contract")
    func checkpointArtifactMatchesContract() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let capturedAt = Date(timeIntervalSince1970: 1_750_000_000)
        let url = try await LearningSessionCaptureService().captureCheckpoint(
            summary: "Link Layer moves packets; GATT structures values.",
            topicID: "ble",
            topicTitle: "Bluetooth Low Energy",
            openQuestion: "Where does ATT sit?",
            knowledgeRoot: root,
            capturedAt: capturedAt
        )

        #expect(url.deletingLastPathComponent().lastPathComponent == "sessions")
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let record = try decoder.decode(LearningSessionRecord.self, from: Data(contentsOf: url))
        #expect(record.schemaVersion == 1)
        #expect(record.revision == 1)
        #expect(record.topicID == "ble")
        #expect(record.summary.contains("Link Layer"))
        #expect(record.openQuestions == ["Where does ATT sit?"])
        #expect(record.confirmedConceptIDs.isEmpty)
        #expect(record.misconceptionIDs.isEmpty)
        #expect(record.sourceRefs.isEmpty)
    }

    @Test("empty learning checkpoint is rejected")
    func emptyCheckpointIsRejected() async {
        do {
            _ = try await LearningSessionCaptureService().captureCheckpoint(
                summary: "   ",
                topicID: nil,
                topicTitle: nil,
                knowledgeRoot: FileManager.default.temporaryDirectory
            )
            Issue.record("Expected an empty-summary error")
        } catch let error as LearningSessionCaptureError {
            #expect(error == .emptySummary)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("intent router consumes only the handled action")
    @MainActor
    func intentRouterConsumesHandledAction() {
        let router = AppIntentRouter.shared
        let action = AppIntentAction.startTodayReview(minutes: 3)
        router.enqueue(action)
        #expect(router.pendingAction == action)
        router.consume(.openTopic(id: "ble"))
        #expect(router.pendingAction == action)
        router.consume(action)
        #expect(router.pendingAction == nil)
    }

    @Test("deep links use the same central intent router")
    @MainActor
    func deepLinksUseIntentRouter() {
        let router = AppIntentRouter.shared
        router.enqueue(url: URL(string: "revember://topic/ble")!)
        #expect(router.pendingAction == .openTopic(id: "ble"))
        router.consume(.openTopic(id: "ble"))

        router.enqueue(url: URL(string: "revember://review?minutes=8")!)
        #expect(router.pendingAction == .startTodayReview(minutes: 8))
        router.consume(.startTodayReview(minutes: 8))
    }
}
