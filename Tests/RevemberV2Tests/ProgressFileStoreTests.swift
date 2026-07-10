import Foundation
import Testing
@testable import RevemberV2Core

@Suite("Progress")
struct ProgressFileStoreTests {
    @Test("answering questions updates progress and weak concepts")
    func answeringUpdatesProgress() {
        var progress = ProgressRecord()
        let question = sampleQuestion()
        let wrongChoice = question.choices.first { $0.isCorrect == false }!

        let isCorrect = progress.recordAnswer(topicID: "ble", question: question, choice: wrongChoice)

        #expect(isCorrect == false)
        #expect(progress.attempts(for: "ble") == 1)
        #expect(progress.score(for: "ble") == 0)
        #expect(progress.topics["ble"]?.weakConceptIDs["link-layer"] == 1)
    }

    @Test("progress persists after save and load")
    func progressPersists() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
            .appendingPathComponent("progress.json")
        let store = ProgressFileStore(progressURL: url)
        var progress = ProgressRecord()
        let question = sampleQuestion()
        let correctChoice = question.choices.first { $0.isCorrect }!
        progress.recordAnswer(topicID: "ble", question: question, choice: correctChoice)

        try store.save(progress)
        let loaded = try store.load()

        #expect(loaded.attempts(for: "ble") == 1)
        #expect(loaded.score(for: "ble") == 1)
    }

    @Test("rated review event and card state persist")
    func reviewStatePersists() throws {
        let url = temporaryProgressURL()
        let store = ProgressFileStore(progressURL: url)
        let question = sampleQuestion()
        let choice = question.choices[0]
        let reviewedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let event = ReviewEvent(
            topicID: "ble",
            questionID: question.id,
            questionRevision: question.revision,
            questionKind: question.kind,
            transferLevel: question.transferLevel,
            questionPrompt: question.prompt,
            choiceID: choice.id,
            selectedChoiceText: choice.text,
            correctChoiceID: question.correctChoice?.id,
            correctChoiceText: question.correctChoice?.text,
            isCorrect: choice.isCorrect,
            rating: .good,
            conceptIDs: question.conceptIDs,
            gapTags: question.gapTags,
            sourceRefs: question.sourceRefs,
            reviewedAt: reviewedAt
        )
        var progress = ProgressRecord()
        progress.recordReview(event, scheduler: ReviewScheduler(clock: FixedReviewClock(reviewedAt)))

        try store.save(progress)
        let loaded = try store.load()

        #expect(loaded.schemaVersion == 2)
        #expect(loaded.reviewEvents == [event])
        #expect(loaded.cardState(topicID: "ble", questionID: "q1")?.lastRating == .good)
        #expect(loaded.cardState(topicID: "ble", questionID: "q1")?.intervalDays == 2)
        #expect(loaded.cardState(topicID: "ble", questionID: "q1")?.questionRevision == question.revision)
    }

    @Test("pre-revision v2 evidence decodes as question revision one")
    func legacyV2EvidenceDefaultsToRevisionOne() throws {
        let url = temporaryProgressURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let json = """
        {
          "schemaVersion": 2,
          "topics": {
            "ble": {
              "reviewCardsByQuestionID": {
                "q1": {
                  "dueAt": "2026-01-02T00:00:00Z",
                  "intervalDays": 1,
                  "stability": 1,
                  "difficulty": 5,
                  "lastRating": "good",
                  "lapses": 0,
                  "reviews": 1,
                  "lastReviewedAt": "2026-01-01T00:00:00Z"
                }
              }
            }
          },
          "reviewEvents": [{
            "id": "11111111-1111-4111-8111-111111111111",
            "topicID": "ble",
            "questionID": "q1",
            "choiceID": "a",
            "isCorrect": true,
            "rating": "good",
            "conceptIDs": ["link-layer"],
            "gapTags": ["layer mapping"],
            "reviewedAt": "2026-01-01T00:00:00Z"
          }]
        }
        """
        try Data(json.utf8).write(to: url)

        let loaded = try ProgressFileStore(progressURL: url).load()

        #expect(loaded.reviewEvents.first?.questionRevision == 1)
        #expect(loaded.reviewEvents.first?.misconceptionIDs.isEmpty == true)
        #expect(loaded.cardState(topicID: "ble", questionID: "q1")?.questionRevision == 1)
    }

    @Test("duplicate event IDs do not double count attempts or scheduling")
    func duplicateEventIsIdempotent() {
        let question = sampleQuestion()
        let reviewedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let event = ReviewEvent(
            id: UUID(uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")!,
            topicID: "ble",
            questionID: question.id,
            choiceID: "a",
            isCorrect: true,
            rating: .good,
            conceptIDs: question.conceptIDs,
            gapTags: question.gapTags,
            reviewedAt: reviewedAt
        )
        var progress = ProgressRecord()
        let scheduler = ReviewScheduler(clock: FixedReviewClock(reviewedAt))

        let first = progress.recordReview(event, scheduler: scheduler)
        let duplicate = progress.recordReview(event, scheduler: scheduler)

        #expect(first)
        #expect(duplicate == false)
        #expect(progress.reviewEvents.count == 1)
        #expect(progress.attempts(for: "ble") == 1)
        #expect(progress.cardState(topicID: "ble", questionID: "q1")?.reviews == 1)
    }

    @Test("legacy v1 files are backed up and migrated without losing aggregates")
    func legacyMigration() throws {
        let url = temporaryProgressURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let legacy = """
        {
          "topics" : {
            "ble" : {
              "attemptsByQuestionID" : {
                "q1" : {
                  "attempts" : 3,
                  "correctAttempts" : 2,
                  "lastAnsweredAt" : "2026-01-01T00:00:00Z"
                }
              },
              "weakConceptIDs" : { "link-layer" : 1 },
              "lastReviewedAt" : "2026-01-01T00:00:00Z"
            }
          }
        }
        """
        let legacyData = Data(legacy.utf8)
        try legacyData.write(to: url)
        let store = ProgressFileStore(progressURL: url, identifierProvider: { "migration-test" })

        let migrated = try store.load()
        let loadedAgain = try store.load()
        let backup = url.deletingLastPathComponent()
            .appendingPathComponent("progress.pre-v2-backup-migration-test.json")

        #expect(migrated.schemaVersion == 2)
        #expect(migrated.attempts(for: "ble") == 3)
        #expect(migrated.score(for: "ble") == 2.0 / 3.0)
        #expect(migrated.topics["ble"]?.weakConceptIDs["link-layer"] == 1)
        #expect(migrated.reviewEvents.isEmpty)
        #expect(migrated.topics["ble"]?.reviewCardsByQuestionID.isEmpty == true)
        #expect(loadedAgain == migrated)
        #expect(try Data(contentsOf: backup) == legacyData)
    }

    @Test("corrupt progress is quarantined instead of overwritten")
    func corruptProgressIsQuarantined() throws {
        let url = temporaryProgressURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let corruptData = Data("{ definitely not json".utf8)
        try corruptData.write(to: url)
        let store = ProgressFileStore(progressURL: url, identifierProvider: { "corrupt-test" })
        let quarantine = url.deletingLastPathComponent()
            .appendingPathComponent("progress.corrupt-corrupt-test.json")

        #expect(throws: ProgressStoreError.self) {
            _ = try store.load()
        }
        #expect(FileManager.default.fileExists(atPath: url.path) == false)
        #expect(try Data(contentsOf: quarantine) == corruptData)
    }

    @Test("future schemas are preserved in place")
    func futureSchemaIsNotQuarantined() throws {
        let url = temporaryProgressURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{ \"schemaVersion\": 99, \"topics\": {} }".utf8).write(to: url)
        let store = ProgressFileStore(progressURL: url, identifierProvider: { "future-test" })

        #expect(throws: ProgressStoreError.self) {
            _ = try store.load()
        }
        #expect(FileManager.default.fileExists(atPath: url.path))
        #expect(FileManager.default.fileExists(
            atPath: url.deletingLastPathComponent()
                .appendingPathComponent("progress.corrupt-future-test.json").path
        ) == false)
    }

    private func temporaryProgressURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
            .appendingPathComponent("progress.json")
    }

    private func sampleQuestion() -> Question {
        Question(
            id: "q1",
            prompt: "Which layer schedules BLE radio packet exchange?",
            difficulty: .intro,
            conceptIDs: ["link-layer"],
            gapTags: ["layer mapping"],
            choices: [
                AnswerChoice(id: "a", text: "Link Layer", isCorrect: true),
                AnswerChoice(id: "b", text: "GATT characteristic", isCorrect: false)
            ],
            explanation: "The Link Layer owns the radio connection mechanics."
        )
    }
}
