import CoreGraphics
import Foundation
import Testing
@testable import RevemberV2Core

@Suite("Knowledge graph")
struct KnowledgeGraphTests {
    private let now = Date(timeIntervalSince1970: 1_750_000_000)

    @Test("authored relationships replace array adjacency")
    func topicGraphUsesAuthoredRelationships() {
        let graph = KnowledgeGraph(topic: sampleTopic(), now: now)

        #expect(graph.nodes.filter { $0.kind == .concept }.count == 2)
        #expect(graph.nodes.filter { $0.kind == .gap }.count == 1)
        #expect(graph.nodes.filter { $0.kind == .question }.count == 1)
        #expect(graph.nodes.filter { $0.layer == .learner }.isEmpty)

        #expect(
            graph.links.contains(
                KnowledgeGraphLink(
                    id: "bits-before-protocol",
                    sourceID: KnowledgeGraphNode.conceptID("bits"),
                    targetID: KnowledgeGraphNode.conceptID("protocol"),
                    kind: .prerequisite,
                    rationale: "Separating representation from meaning makes the need for protocol rules clear.",
                    sourceRefs: ["lesson"]
                )
            )
        )
        #expect(graph.links.contains { $0.kind == .gapConcept })
        #expect(graph.links.contains { $0.kind == .questionConcept })
    }

    @Test("concept order never invents semantic links")
    func conceptOrderDoesNotCreateRelationships() {
        var topic = sampleTopic()
        topic.relationships = []

        let graph = KnowledgeGraph(topic: topic, now: now)

        #expect(graph.links.contains { $0.kind.isAuthoredKnowledgeRelationship } == false)
    }

    @Test("review event and card state create learner evidence")
    func reviewEvidenceCreatesLearnerLayer() {
        let topic = sampleTopic()
        let eventID = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
        let event = ReviewEvent(
            id: eventID,
            topicID: topic.id,
            questionID: "q1",
            choiceID: "b",
            isCorrect: false,
            rating: .missed,
            conceptIDs: ["protocol"],
            gapTags: ["protocol/schema"],
            reviewedAt: now
        )
        var progress = ProgressRecord()
        let didRecord = progress.recordReview(event)
        #expect(didRecord)

        let graph = KnowledgeGraph(topic: topic, progress: progress, now: now)

        let cardID = KnowledgeGraphNode.reviewCardID("q1")
        let reviewEventID = KnowledgeGraphNode.reviewEventID(eventID)
        #expect(graph.node(withID: cardID)?.kind == .reviewCard)
        #expect(graph.node(withID: reviewEventID)?.kind == .reviewEvent)
        #expect(graph.node(withID: cardID)?.evidenceStatus == .fragile)
        #expect(graph.evidence(forConceptID: "protocol") == .fragile)
        #expect(graph.links.contains { $0.sourceID == reviewEventID && $0.targetID == cardID && $0.kind == .eventCard })
        #expect(
            graph.links.contains {
                $0.sourceID == reviewEventID
                    && $0.targetID == KnowledgeGraphNode.conceptID("protocol")
                    && $0.kind == .eventConcept
            }
        )
    }

    @Test("current card evidence can repair an earlier miss")
    func laterSuccessRepairsFragileStatus() {
        let topic = sampleTopic()
        var progress = ProgressRecord()
        let missed = ReviewEvent(
            topicID: topic.id,
            questionID: "q1",
            choiceID: "b",
            isCorrect: false,
            rating: .missed,
            conceptIDs: ["protocol"],
            gapTags: ["protocol/schema"],
            reviewedAt: now
        )
        let repaired = ReviewEvent(
            topicID: topic.id,
            questionID: "q1",
            choiceID: "a",
            isCorrect: true,
            rating: .good,
            conceptIDs: ["protocol"],
            gapTags: ["protocol/schema"],
            reviewedAt: now.addingTimeInterval(86_400)
        )
        let recordedMiss = progress.recordReview(missed)
        let recordedRepair = progress.recordReview(repaired)
        #expect(recordedMiss)
        #expect(recordedRepair)

        let graph = KnowledgeGraph(
            topic: topic,
            progress: progress,
            now: now.addingTimeInterval(86_400)
        )

        #expect(graph.evidence(forConceptID: "protocol") == .stable)
        #expect(graph.node(withID: KnowledgeGraphNode.reviewCardID("q1"))?.reviewCount == 2)
    }

    @Test("incorrect retrieval stays fragile even when self-rated easy")
    func correctnessOverridesEffortForEvidence() {
        let topic = sampleTopic()
        let event = ReviewEvent(
            topicID: topic.id,
            questionID: "q1",
            choiceID: "b",
            isCorrect: false,
            rating: .easy,
            conceptIDs: ["protocol"],
            gapTags: ["protocol/schema"],
            misconceptionIDs: ["medium-implies-meaning"],
            reviewedAt: now
        )
        var progress = ProgressRecord()
        let didRecord = progress.recordReview(event)
        #expect(didRecord)

        let graph = KnowledgeGraph(topic: topic, progress: progress, now: now)

        #expect(graph.evidence(forConceptID: "protocol") == .fragile)
        #expect(graph.node(withID: KnowledgeGraphNode.questionID("q1"))?.evidenceStatus == .fragile)
        #expect(graph.node(withID: KnowledgeGraphNode.reviewEventID(event.id))?.evidenceSummary.contains("medium-implies-meaning") == true)
        #expect(progress.cardState(topicID: topic.id, questionID: "q1")?.lastRating == .missed)
    }

    @Test("question revisions invalidate old mastery while preserving historical events")
    func revisedQuestionRequiresFreshEvidence() {
        var topic = sampleTopic()
        topic.questions[0].revision = 2
        let oldEvent = ReviewEvent(
            topicID: topic.id,
            questionID: "q1",
            questionRevision: 1,
            choiceID: "a",
            isCorrect: true,
            rating: .easy,
            conceptIDs: ["protocol"],
            gapTags: ["protocol/schema"],
            reviewedAt: now
        )
        var progress = ProgressRecord()
        let didRecordOldEvent = progress.recordReview(oldEvent)
        #expect(didRecordOldEvent)

        let staleGraph = KnowledgeGraph(topic: topic, progress: progress, now: now)
        let oldEventNodeID = KnowledgeGraphNode.reviewEventID(oldEvent.id)
        #expect(staleGraph.evidence(forConceptID: "protocol") == .untested)
        #expect(staleGraph.node(withID: KnowledgeGraphNode.questionID("q1"))?.evidenceSummary.contains("fresh retrieval") == true)
        #expect(staleGraph.node(withID: KnowledgeGraphNode.reviewCardID("q1")) == nil)
        #expect(staleGraph.node(withID: oldEventNodeID) != nil)
        #expect(staleGraph.links.contains { $0.sourceID == oldEventNodeID && $0.kind == .eventCard } == false)

        let currentEvent = ReviewEvent(
            topicID: topic.id,
            questionID: "q1",
            questionRevision: 2,
            choiceID: "a",
            isCorrect: true,
            rating: .good,
            conceptIDs: ["protocol"],
            gapTags: ["protocol/schema"],
            reviewedAt: now.addingTimeInterval(60)
        )
        let didRecordCurrentEvent = progress.recordReview(currentEvent)
        #expect(didRecordCurrentEvent)
        let repairedGraph = KnowledgeGraph(topic: topic, progress: progress, now: now.addingTimeInterval(60))

        #expect(repairedGraph.evidence(forConceptID: "protocol") == .stable)
        #expect(repairedGraph.node(withID: KnowledgeGraphNode.reviewCardID("q1"))?.reviewCount == 1)
        #expect(progress.cardState(topicID: topic.id, questionID: "q1")?.questionRevision == 2)
    }

    @Test("layer filtering hides links whose endpoints are hidden")
    func graphFilteringRemovesHiddenEndpointLinks() {
        let event = ReviewEvent(
            topicID: "ble",
            questionID: "q1",
            choiceID: "a",
            isCorrect: true,
            rating: .good,
            conceptIDs: ["protocol"],
            gapTags: [],
            reviewedAt: now
        )
        var progress = ProgressRecord()
        let didRecord = progress.recordReview(event)
        #expect(didRecord)
        let graph = KnowledgeGraph(topic: sampleTopic(), progress: progress, now: now)

        let knowledgeOnly = graph.filtered(including: [.knowledge])
        #expect(knowledgeOnly.nodes.allSatisfy { $0.layer == .knowledge })
        #expect(knowledgeOnly.links.allSatisfy { $0.kind.isAuthoredKnowledgeRelationship })

        let learnerOnly = graph.filtered(including: [.learner])
        #expect(learnerOnly.nodes.allSatisfy { $0.layer == .learner })
        #expect(learnerOnly.links.contains { $0.kind == .eventCard })
        #expect(learnerOnly.links.contains { $0.kind == .eventConcept } == false)
    }

    @Test("layout returns positions for every visible node")
    func graphLayoutPositionsEveryNode() {
        let graph = KnowledgeGraph(topic: sampleTopic(), now: now)
        let positions = KnowledgeGraphLayout.positions(for: graph, in: CGSize(width: 900, height: 540))

        #expect(positions.count == graph.nodes.count)
        #expect(positions.values.allSatisfy { $0.x >= 0 && $0.y >= 0 })
    }

    @Test("dangling authored and assessment references are dropped")
    func danglingReferencesAreDropped() {
        let question = Question(
            id: "q-missing",
            prompt: "Question with missing concept",
            difficulty: .intro,
            conceptIDs: ["missing-concept"],
            gapTags: [],
            choices: [AnswerChoice(id: "a", text: "Answer", isCorrect: true)],
            explanation: "Missing concept references should not create orphaned edges."
        )
        let topic = KnowledgeTopic(
            id: "sparse",
            title: "Sparse",
            summary: "Sparse graph.",
            relationships: [
                KnowledgeRelationship(
                    id: "missing-relationship",
                    sourceConceptID: "missing-one",
                    targetConceptID: "missing-two",
                    kind: .enables,
                    rationale: "Both endpoints are absent."
                )
            ],
            concepts: [],
            gaps: [
                Gap(
                    id: "missing-gap",
                    title: "Missing Gap",
                    tag: "dangling",
                    description: "Points at a missing concept.",
                    conceptIDs: ["missing-concept"]
                )
            ],
            questions: [question]
        )

        let graph = KnowledgeGraph(topic: topic, now: now)

        #expect(graph.nodes.count == 2)
        #expect(graph.links.isEmpty)
        #expect(KnowledgeGraphLayout.positions(for: graph, in: CGSize(width: 420, height: 300)).count == 2)
    }

    @Test("empty topics produce empty graphs")
    func emptyTopicProducesEmptyGraph() {
        let topic = KnowledgeTopic(id: "empty", title: "Empty", summary: "No data.", concepts: [], gaps: [], questions: [])
        let graph = KnowledgeGraph(topic: topic, now: now)

        #expect(graph.nodes.isEmpty)
        #expect(graph.links.isEmpty)
        #expect(KnowledgeGraphLayout.positions(for: graph, in: CGSize(width: 400, height: 300)).isEmpty)
    }

    private func sampleTopic() -> KnowledgeTopic {
        KnowledgeTopic(
            revision: 2,
            id: "ble",
            title: "Bluetooth Low Energy",
            summary: "BLE fundamentals.",
            sources: [
                KnowledgeSource(id: "lesson", kind: "note", title: "BLE lesson", locator: "notes/ble.md")
            ],
            relationships: [
                KnowledgeRelationship(
                    id: "bits-before-protocol",
                    sourceConceptID: "bits",
                    targetConceptID: "protocol",
                    kind: .prerequisite,
                    rationale: "Separating representation from meaning makes the need for protocol rules clear.",
                    sourceRefs: ["lesson"]
                )
            ],
            concepts: [
                Concept(
                    id: "bits",
                    title: "Bits",
                    firstPrinciples: "A bit is a distinguishable physical state.",
                    explanation: "Software names the state 0 or 1.",
                    relatedTerms: ["byte"],
                    confusableTerms: ["protocol"],
                    gapTags: ["physical substrate"]
                ),
                Concept(
                    id: "protocol",
                    title: "Protocol",
                    firstPrinciples: "A protocol is a rulebook.",
                    explanation: "Protocols make bit patterns interpretable.",
                    relatedTerms: ["schema"],
                    confusableTerms: ["radio"],
                    gapTags: ["protocol/schema"]
                )
            ],
            gaps: [
                Gap(
                    id: "physical-vs-meaning",
                    title: "Physical Signal vs Meaning",
                    tag: "protocol/schema",
                    description: "Physical state and meaning are different layers.",
                    conceptIDs: ["bits", "protocol"]
                )
            ],
            questions: [
                Question(
                    id: "q1",
                    kind: .explain,
                    transferLevel: .application,
                    prompt: "Why do two devices need a protocol?",
                    difficulty: .intro,
                    conceptIDs: ["protocol"],
                    gapTags: ["protocol/schema"],
                    sourceRefs: ["lesson"],
                    choices: [
                        AnswerChoice(
                            id: "a",
                            text: "To interpret bit patterns consistently.",
                            isCorrect: true,
                            rationale: "Shared rules align meaning."
                        ),
                        AnswerChoice(
                            id: "b",
                            text: "To create electricity.",
                            isCorrect: false,
                            rationale: "Transporting states does not assign meaning.",
                            misconceptionID: "medium-implies-meaning"
                        )
                    ],
                    explanation: "A protocol makes exchanged bit patterns meaningful."
                )
            ]
        )
    }
}
