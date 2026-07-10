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
        #expect(topics[0].schemaVersion == 1)
        #expect(topics[0].revision == 0)
        #expect(topics[0].sources.isEmpty)
        #expect(topics[0].relationships.isEmpty)
        #expect(topics[0].questions[0].revision == 1)
        #expect(topics[0].questions[0].kind == .multipleChoice)
        #expect(topics[0].questions[0].transferLevel == .recall)
        #expect(topics[0].questions[0].sourceRefs.isEmpty)
        #expect(topics[0].questions[0].choices[0].rationale == nil)
    }

    @Test("versioned topic metadata and diagnostic choices load")
    func versionedTopicLoads() throws {
        let root = try temporaryKnowledgeRoot()
        let topicsDirectory = root.appendingPathComponent("topics", isDirectory: true)
        let json = """
        {
          "schemaVersion": 2,
          "revision": 7,
          "id": "ble",
          "title": "Bluetooth Low Energy",
          "summary": "BLE fundamentals.",
          "sources": [
            {
              "id": "note",
              "kind": "note",
              "title": "BLE lesson",
              "locator": "notes/ble.md",
              "fingerprint": "sha256:abc",
              "capturedAt": "2026-07-09T08:00:00Z"
            }
          ],
          "relationships": [
            {
              "id": "bits-enable-protocol",
              "sourceConceptID": "bits",
              "targetConceptID": "protocol",
              "kind": "enables",
              "rationale": "Representations need shared rules.",
              "sourceRefs": ["note"]
            }
          ],
          "concepts": [
            {
              "id": "bits",
              "title": "Bits",
              "firstPrinciples": "A bit is a distinguishable state.",
              "explanation": "Bits carry representation.",
              "relatedTerms": [],
              "confusableTerms": [],
              "gapTags": []
            },
            {
              "id": "protocol",
              "title": "Protocol",
              "firstPrinciples": "A protocol supplies shared rules.",
              "explanation": "Rules give representations meaning.",
              "relatedTerms": [],
              "confusableTerms": [],
              "gapTags": []
            }
          ],
          "gaps": [],
          "questions": [
            {
              "id": "q1",
              "revision": 3,
              "kind": "predict",
              "transferLevel": "transfer",
              "prompt": "What will the receiver know?",
              "difficulty": "hard",
              "conceptIDs": ["protocol"],
              "gapTags": ["protocol/schema"],
              "sourceRefs": ["note"],
              "choices": [
                {
                  "id": "a",
                  "text": "Only the delivered bytes until a schema is applied.",
                  "isCorrect": true,
                  "rationale": "Delivery and meaning are separate."
                },
                {
                  "id": "b",
                  "text": "Every custom field automatically.",
                  "isCorrect": false,
                  "rationale": "GATT cannot infer arbitrary schemas.",
                  "misconceptionID": "gatt-auto-schema"
                }
              ],
              "explanation": "The app applies the payload schema."
            }
          ]
        }
        """
        try json.write(
            to: topicsDirectory.appendingPathComponent("ble.json"),
            atomically: true,
            encoding: .utf8
        )

        let topic = try #require(KnowledgeLoader().loadTopics(from: root).first)

        #expect(topic.schemaVersion == 2)
        #expect(topic.revision == 7)
        #expect(topic.sources.first?.capturedAt != nil)
        #expect(topic.relationships.first?.kind == .enables)
        #expect(topic.questions.first?.revision == 3)
        #expect(topic.questions.first?.kind == .predict)
        #expect(topic.questions.first?.transferLevel == .transfer)
        #expect(topic.questions.first?.choices.last?.misconceptionID == "gatt-auto-schema")
    }

    @Test("checked-in BLE knowledge satisfies the Swift contract")
    func checkedInBLEFixtureLoads() throws {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let knowledgeRoot = repositoryRoot
            .appendingPathComponent("RevemberKnowledge", isDirectory: true)

        let topic = try #require(KnowledgeLoader().loadTopics(from: knowledgeRoot).first { $0.id == "ble" })

        #expect(topic.schemaVersion == 2)
        #expect(topic.sources.isEmpty == false)
        #expect(topic.relationships.isEmpty == false)
        #expect(topic.concepts.allSatisfy { $0.sourceRefs.isEmpty == false })
        #expect(topic.gaps.allSatisfy { $0.sourceRefs.isEmpty == false })
        #expect(topic.gaps.allSatisfy { $0.misconceptionIDs.isEmpty == false })
        #expect(topic.questions.allSatisfy { $0.revision > 0 && $0.sourceRefs.isEmpty == false })
        #expect(topic.questions.flatMap(\.choices).allSatisfy { $0.rationale?.isEmpty == false })
        #expect(
            topic.questions
                .flatMap(\.choices)
                .filter { $0.isCorrect == false }
                .allSatisfy { $0.misconceptionID?.isEmpty == false }
        )
    }

    @Test("future topic schemas are rejected without partial decoding")
    func futureSchemaIsRejected() throws {
        let root = try temporaryKnowledgeRoot()
        let json = """
        {
          "schemaVersion": 999,
          "revision": 1,
          "id": "future",
          "title": "Future",
          "summary": "Unknown contract.",
          "concepts": [],
          "gaps": [],
          "questions": []
        }
        """
        try writeRawTopic(json, named: "future.json", to: root)

        #expect(throws: KnowledgeLoadError.self) {
            _ = try KnowledgeLoader().loadTopics(from: root)
        }
    }

    @Test("semantic reference errors are rejected with the file name")
    func semanticErrorsAreRejected() throws {
        let root = try temporaryKnowledgeRoot()
        let json = """
        {
          "schemaVersion": 2,
          "revision": 1,
          "id": "broken",
          "title": "Broken",
          "summary": "Dangling evidence.",
          "sources": [],
          "relationships": [],
          "concepts": [],
          "gaps": [],
          "questions": [{
            "id": "q1",
            "revision": 1,
            "prompt": "Broken?",
            "difficulty": "intro",
            "conceptIDs": ["missing"],
            "gapTags": [],
            "choices": [
              {"id": "a", "text": "A", "isCorrect": true},
              {"id": "b", "text": "B", "isCorrect": true}
            ],
            "explanation": "Invalid."
          }]
        }
        """
        try writeRawTopic(json, named: "broken.json", to: root)

        do {
            _ = try KnowledgeLoader().loadTopics(from: root)
            Issue.record("Expected semantic validation failure")
        } catch let error as KnowledgeLoadError {
            #expect(error.localizedDescription.contains("broken.json"))
            #expect(error.localizedDescription.contains("missing concept"))
            #expect(error.localizedDescription.contains("exactly one correct choice"))
        }
    }

    @Test("topic IDs must match their file names")
    func topicIDMustMatchFileName() throws {
        let root = try temporaryKnowledgeRoot()
        let json = """
        {
          "id": "inside-id",
          "title": "Mismatch",
          "summary": "The filename is part of identity.",
          "concepts": [],
          "gaps": [],
          "questions": []
        }
        """
        try writeRawTopic(json, named: "outside-id.json", to: root)

        do {
            _ = try KnowledgeLoader().loadTopics(from: root)
            Issue.record("Expected file identity validation failure")
        } catch let error as KnowledgeLoadError {
            #expect(error.localizedDescription.contains("must match file name"))
        }
    }

    @Test("free recall withholds recognition cues until reveal")
    func freeRecallRequiresReveal() {
        #expect(QuestionKind.freeRecall.requiresRecallBeforeChoices)
        #expect(QuestionKind.multipleChoice.requiresRecallBeforeChoices == false)
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

    private func writeRawTopic(_ json: String, named fileName: String, to root: URL) throws {
        try json.write(
            to: root.appendingPathComponent("topics", isDirectory: true).appendingPathComponent(fileName),
            atomically: true,
            encoding: .utf8
        )
    }
}
