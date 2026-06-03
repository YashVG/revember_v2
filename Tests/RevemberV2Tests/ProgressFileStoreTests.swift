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
