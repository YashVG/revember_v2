import Foundation
import Testing
@testable import RevemberV2Core

@Suite("Knowledge loading")
struct KnowledgeLoaderTests {
    @Test("valid topic JSON loads from topics directory")
    func validTopicLoads() throws {
        let root = try temporaryKnowledgeRoot()
        try writeTopicJSON(to: root, fileName: "ble.json")

        let topics = try KnowledgeLoader().loadTopics(from: root)

        #expect(topics.count == 1)
        #expect(topics[0].id == "ble")
        #expect(topics[0].questions.count == 1)
    }

    @Test("malformed topic JSON reports the file name")
    func malformedTopicReportsFile() throws {
        let root = try temporaryKnowledgeRoot()
        let topics = root.appendingPathComponent("topics", isDirectory: true)
        try "{ bad json".write(to: topics.appendingPathComponent("broken.json"), atomically: true, encoding: .utf8)

        do {
            _ = try KnowledgeLoader().loadTopics(from: root)
            Issue.record("Expected malformed file error")
        } catch let error as KnowledgeLoadError {
            #expect(error.localizedDescription.contains("broken.json"))
        }
    }

    @Test("missing topics directory loads as empty")
    func missingTopicsDirectoryLoadsEmpty() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)

        let topics = try KnowledgeLoader().loadTopics(from: root)

        #expect(topics.isEmpty)
    }

    private func temporaryKnowledgeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let topics = root.appendingPathComponent("topics", isDirectory: true)
        try FileManager.default.createDirectory(at: topics, withIntermediateDirectories: true)
        return root
    }

    private func writeTopicJSON(to root: URL, fileName: String) throws {
        let topics = root.appendingPathComponent("topics", isDirectory: true)
        let json = """
        {
          "id": "ble",
          "title": "Bluetooth Low Energy",
          "summary": "BLE fundamentals.",
          "concepts": [
            {
              "id": "bits",
              "title": "Bits",
              "firstPrinciples": "A bit is a distinguishable physical state.",
              "explanation": "Software names the state 0 or 1.",
              "relatedTerms": ["byte"],
              "confusableTerms": ["protocol"],
              "gapTags": ["physical substrate"]
            }
          ],
          "gaps": [],
          "questions": [
            {
              "id": "q1",
              "prompt": "What is a bit at the lowest useful level?",
              "difficulty": "intro",
              "conceptIDs": ["bits"],
              "gapTags": ["physical substrate"],
              "choices": [
                { "id": "a", "text": "A distinguishable physical state interpreted as 0 or 1.", "isCorrect": true },
                { "id": "b", "text": "A Bluetooth packet.", "isCorrect": false }
              ],
              "explanation": "The physical state comes first; protocols interpret patterns later."
            }
          ]
        }
        """
        try json.write(to: topics.appendingPathComponent(fileName), atomically: true, encoding: .utf8)
    }
}
