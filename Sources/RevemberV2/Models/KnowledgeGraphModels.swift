import CoreGraphics
import Foundation

public struct KnowledgeGraph: Equatable, Sendable {
    public var nodes: [KnowledgeGraphNode]
    public var links: [KnowledgeGraphLink]

    public init(nodes: [KnowledgeGraphNode], links: [KnowledgeGraphLink]) {
        self.nodes = nodes
        self.links = links
    }

    public init(
        topic: KnowledgeTopic,
        progress: ProgressRecord = ProgressRecord(),
        now: Date = Date(),
        maximumReviewEvents: Int = 24
    ) {
        var nodes: [KnowledgeGraphNode] = []
        var links: [KnowledgeGraphLink] = []
        let activeQuestions = topic.questions.filter { $0.retiredAt == nil }

        for concept in topic.concepts {
            let evidence = Self.conceptEvidence(
                conceptID: concept.id,
                topic: topic,
                progress: progress,
                now: now
            )
            nodes.append(
                KnowledgeGraphNode(
                    id: KnowledgeGraphNode.conceptID(concept.id),
                    title: concept.title,
                    subtitle: concept.firstPrinciples,
                    kind: .concept,
                    weight: 4 + concept.gapTags.count + concept.confusableTerms.count,
                    evidenceStatus: evidence.status,
                    evidenceSummary: evidence.summary,
                    reviewCount: evidence.reviewCount
                )
            )
        }

        for gap in topic.gaps {
            let misconceptionIDs = Set(gap.misconceptionIDs)
            let directlyLinkedQuestions = activeQuestions.filter { question in
                question.gapTags.contains(gap.tag)
                    || question.choices.contains { choice in
                        choice.misconceptionID.map(misconceptionIDs.contains) ?? false
                    }
            }
            let linkedQuestions = directlyLinkedQuestions.isEmpty
                ? activeQuestions.filter { question in
                    Set(question.conceptIDs).isDisjoint(with: Set(gap.conceptIDs)) == false
                }
                : directlyLinkedQuestions
            let evidence = Self.aggregateEvidence(
                questions: linkedQuestions,
                topicID: topic.id,
                progress: progress,
                now: now
            )
            let gapID = KnowledgeGraphNode.gapID(gap.id)
            nodes.append(
                KnowledgeGraphNode(
                    id: gapID,
                    title: gap.title,
                    subtitle: gap.tag,
                    kind: .gap,
                    weight: max(2, gap.conceptIDs.count),
                    evidenceStatus: evidence.status,
                    evidenceSummary: evidence.summary,
                    reviewCount: evidence.reviewCount
                )
            )

            for conceptID in gap.conceptIDs {
                links.append(
                    KnowledgeGraphLink(
                        sourceID: gapID,
                        targetID: KnowledgeGraphNode.conceptID(conceptID),
                        kind: .gapConcept,
                        rationale: gap.description
                    )
                )
            }
        }

        for question in activeQuestions {
            let storedCardState = progress.cardState(topicID: topic.id, questionID: question.id)
            let cardState = storedCardState.flatMap {
                $0.questionRevision == question.revision ? $0 : nil
            }
            let currentEvents = progress.events(forQuestionID: question.id, topicID: topic.id)
                .filter { $0.questionRevision == question.revision }
            let evidence = Self.questionEvidence(
                question: question,
                cardState: cardState,
                currentEvents: currentEvents,
                hasStaleEvidence: storedCardState != nil || progress.events(
                    forQuestionID: question.id,
                    topicID: topic.id
                ).isEmpty == false,
                now: now
            )
            let questionID = KnowledgeGraphNode.questionID(question.id)
            nodes.append(
                KnowledgeGraphNode(
                    id: questionID,
                    title: question.prompt,
                    subtitle: "\(question.kind.title) · \(question.transferLevel.title)",
                    kind: .question,
                    weight: max(1, question.conceptIDs.count),
                    evidenceStatus: evidence.status,
                    evidenceSummary: evidence.summary,
                    reviewCount: evidence.reviewCount
                )
            )

            for conceptID in question.conceptIDs {
                links.append(
                    KnowledgeGraphLink(
                        sourceID: questionID,
                        targetID: KnowledgeGraphNode.conceptID(conceptID),
                        kind: .questionConcept,
                        rationale: question.explanation,
                        sourceRefs: question.sourceRefs
                    )
                )
            }

            if let cardState {
                let cardID = KnowledgeGraphNode.reviewCardID(question.id)
                nodes.append(
                    KnowledgeGraphNode(
                        id: cardID,
                        title: "Review state: \(question.prompt)",
                        subtitle: Self.cardSubtitle(cardState, now: now),
                        kind: .reviewCard,
                        weight: max(2, min(8, cardState.reviews)),
                        evidenceStatus: evidence.status,
                        evidenceSummary: evidence.summary,
                        reviewCount: cardState.reviews
                    )
                )
                links.append(
                    KnowledgeGraphLink(
                        sourceID: cardID,
                        targetID: questionID,
                        kind: .cardQuestion,
                        rationale: "This scheduler state is derived from reviews of this check."
                    )
                )
            }
        }

        for relationship in topic.relationships {
            links.append(
                KnowledgeGraphLink(
                    id: relationship.id,
                    sourceID: KnowledgeGraphNode.conceptID(relationship.sourceConceptID),
                    targetID: KnowledgeGraphNode.conceptID(relationship.targetConceptID),
                    kind: KnowledgeGraphLink.Kind(relationship.kind),
                    rationale: relationship.rationale,
                    sourceRefs: relationship.sourceRefs
                )
            )
        }

        let knownQuestionIDs = Set(topic.questions.map(\.id))
        let recentEvents = progress.events(forTopicID: topic.id)
            .filter { knownQuestionIDs.contains($0.questionID) }
            .sorted { $0.reviewedAt > $1.reviewedAt }
            .prefix(max(0, maximumReviewEvents))

        for event in recentEvents {
            let eventID = KnowledgeGraphNode.reviewEventID(event.id)
            let eventStatus = Self.eventStatus(event)
            let misconceptionText = event.misconceptionIDs.isEmpty
                ? ""
                : " · misconception: \(event.misconceptionIDs.joined(separator: ", "))"
            nodes.append(
                KnowledgeGraphNode(
                    id: eventID,
                    title: event.isCorrect ? "Correct retrieval" : "Missed retrieval",
                    subtitle: "Check r\(event.questionRevision) · \(event.rating.title) · \(event.reviewedAt.formatted(date: .abbreviated, time: .shortened))",
                    kind: .reviewEvent,
                    weight: 2,
                    evidenceStatus: eventStatus,
                    evidenceSummary: "Recorded evidence for \(event.questionID) r\(event.questionRevision) · \(event.rating.title)\(misconceptionText)",
                    reviewCount: 1
                )
            )

            let cardID = KnowledgeGraphNode.reviewCardID(event.questionID)
            let currentQuestionRevision = activeQuestions.first(where: { $0.id == event.questionID })?.revision
            if currentQuestionRevision == event.questionRevision,
               nodes.contains(where: { $0.id == cardID }) {
                links.append(
                    KnowledgeGraphLink(
                        sourceID: eventID,
                        targetID: cardID,
                        kind: .eventCard,
                        rationale: "This immutable review event contributed to the current card state."
                    )
                )
            }

            for conceptID in event.conceptIDs {
                links.append(
                    KnowledgeGraphLink(
                        sourceID: eventID,
                        targetID: KnowledgeGraphNode.conceptID(conceptID),
                        kind: .eventConcept,
                        rationale: "This review recorded direct learner evidence for the concept."
                    )
                )
            }
        }

        self.nodes = nodes
        self.links = links.filter { link in
            nodes.contains { $0.id == link.sourceID } && nodes.contains { $0.id == link.targetID }
        }
    }

    public func filtered(including kinds: Set<KnowledgeGraphNode.Kind>) -> KnowledgeGraph {
        let visibleNodes = nodes.filter { kinds.contains($0.kind) }
        return filtered(to: visibleNodes)
    }

    public func filtered(including layers: Set<KnowledgeGraphNode.Layer>) -> KnowledgeGraph {
        let visibleNodes = nodes.filter { layers.contains($0.layer) }
        return filtered(to: visibleNodes)
    }

    public func node(withID id: KnowledgeGraphNode.ID?) -> KnowledgeGraphNode? {
        guard let id else { return nil }
        return nodes.first { $0.id == id }
    }

    public func evidence(forConceptID conceptID: String) -> KnowledgeGraphNode.EvidenceStatus {
        node(withID: KnowledgeGraphNode.conceptID(conceptID))?.evidenceStatus ?? .untested
    }

    public func evidenceSummary(forConceptID conceptID: String) -> String {
        node(withID: KnowledgeGraphNode.conceptID(conceptID))?.evidenceSummary ?? "No review evidence"
    }

    private func filtered(to visibleNodes: [KnowledgeGraphNode]) -> KnowledgeGraph {
        let visibleNodeIDs = Set(visibleNodes.map(\.id))
        let visibleLinks = links.filter { link in
            visibleNodeIDs.contains(link.sourceID) && visibleNodeIDs.contains(link.targetID)
        }
        return KnowledgeGraph(nodes: visibleNodes, links: visibleLinks)
    }

    private static func conceptEvidence(
        conceptID: String,
        topic: KnowledgeTopic,
        progress: ProgressRecord,
        now: Date
    ) -> EvidenceSnapshot {
        let questions = topic.questions
            .filter { $0.retiredAt == nil && $0.conceptIDs.contains(conceptID) }
        return aggregateEvidence(questions: questions, topicID: topic.id, progress: progress, now: now)
    }

    private static func aggregateEvidence(
        questions: [Question],
        topicID: String,
        progress: ProgressRecord,
        now: Date
    ) -> EvidenceSnapshot {
        guard questions.isEmpty == false else {
            return EvidenceSnapshot(status: .untested, summary: "No linked checks", reviewCount: 0)
        }

        let snapshots = questions.map { question -> EvidenceSnapshot in
            let storedState = progress.cardState(topicID: topicID, questionID: question.id)
            let currentState = storedState.flatMap {
                $0.questionRevision == question.revision ? $0 : nil
            }
            let allEvents = progress.events(forQuestionID: question.id, topicID: topicID)
            let currentEvents = allEvents.filter { $0.questionRevision == question.revision }
            return questionEvidence(
                question: question,
                cardState: currentState,
                currentEvents: currentEvents,
                hasStaleEvidence: storedState != nil || allEvents.isEmpty == false,
                now: now
            )
        }
        let testedSnapshots = snapshots.filter { $0.reviewCount > 0 }
        guard testedSnapshots.isEmpty == false else {
            if snapshots.contains(where: { $0.isStale }) {
                return EvidenceSnapshot(
                    status: .untested,
                    summary: "Linked checks changed · fresh retrieval required",
                    reviewCount: 0,
                    isStale: true
                )
            }
            return EvidenceSnapshot(status: .untested, summary: "No review evidence", reviewCount: 0)
        }

        let status: KnowledgeGraphNode.EvidenceStatus
        if testedSnapshots.contains(where: { $0.status == .fragile }) {
            status = .fragile
        } else if testedSnapshots.count < questions.count
                    || testedSnapshots.contains(where: { $0.status == .developing }) {
            status = .developing
        } else {
            status = .stable
        }

        let reviews = testedSnapshots.reduce(0) { $0 + $1.reviewCount }
        let due = questions.filter { question in
            guard let state = progress.cardState(topicID: topicID, questionID: question.id),
                  state.questionRevision == question.revision
            else { return false }
            return state.dueAt <= now
        }.count
        let dueText = due > 0 ? " · \(due) due" : ""
        let hasStaleEvidence = snapshots.contains { $0.isStale }
        let staleText = hasStaleEvidence ? " · stale evidence excluded" : ""
        return EvidenceSnapshot(
            status: status,
            summary: "\(testedSnapshots.count)/\(questions.count) checks current · \(reviews) events\(dueText)\(staleText)",
            reviewCount: reviews,
            isStale: hasStaleEvidence
        )
    }

    private static func questionEvidence(
        question: Question,
        cardState: ReviewCardState?,
        currentEvents: [ReviewEvent],
        hasStaleEvidence: Bool,
        now: Date
    ) -> EvidenceSnapshot {
        guard let cardState, cardState.reviews > 0 else {
            if hasStaleEvidence {
                return EvidenceSnapshot(
                    status: .untested,
                    summary: "Check revised to r\(question.revision) · fresh retrieval required",
                    reviewCount: 0,
                    isStale: true
                )
            }
            return EvidenceSnapshot(status: .untested, summary: "No review evidence", reviewCount: 0)
        }

        let latestEvent = currentEvents.max { $0.reviewedAt < $1.reviewedAt }
        let status: KnowledgeGraphNode.EvidenceStatus
        if latestEvent?.isCorrect == false {
            status = .fragile
        } else {
            switch latestEvent?.rating ?? cardState.lastRating {
            case .missed:
                status = .fragile
            case .hard:
                status = .developing
            case .good, .easy:
                status = .stable
            case nil:
                status = .untested
            }
        }

        let dueText = cardState.dueAt <= now
            ? " · due now"
            : " · next in \(Self.daysUntil(cardState.dueAt, from: now))d"
        let correctnessText: String
        switch latestEvent?.isCorrect {
        case true: correctnessText = "correct"
        case false: correctnessText = "incorrect"
        case nil: correctnessText = "legacy evidence"
        }
        return EvidenceSnapshot(
            status: status,
            summary: "\(cardState.reviews) reviews · latest \(correctnessText) / \((latestEvent?.rating ?? cardState.lastRating)?.title ?? "unrated")\(dueText)",
            reviewCount: cardState.reviews
        )
    }

    private static func eventStatus(_ event: ReviewEvent) -> KnowledgeGraphNode.EvidenceStatus {
        guard event.isCorrect else { return .fragile }
        switch event.rating {
        case .missed: return .fragile
        case .hard: return .developing
        case .good, .easy: return .stable
        }
    }

    private static func cardSubtitle(_ state: ReviewCardState, now: Date) -> String {
        let due = state.dueAt <= now ? "Due now" : "Due in \(daysUntil(state.dueAt, from: now))d"
        return "Check r\(state.questionRevision) · \(due) · \(state.reviews) reviews · stability \(state.stability.formatted(.number.precision(.fractionLength(1))))"
    }

    private static func daysUntil(_ date: Date, from now: Date) -> Int {
        max(1, Int(ceil(date.timeIntervalSince(now) / 86_400)))
    }

    private struct EvidenceSnapshot {
        var status: KnowledgeGraphNode.EvidenceStatus
        var summary: String
        var reviewCount: Int
        var isStale: Bool = false
    }
}

public struct KnowledgeGraphNode: Identifiable, Hashable, Sendable {
    public enum Layer: String, CaseIterable, Codable, Sendable {
        case knowledge
        case assessment
        case learner

        public var title: String { rawValue.capitalized }
    }

    public enum Kind: String, CaseIterable, Codable, Sendable {
        case concept
        case gap
        case question
        case reviewCard
        case reviewEvent

        public var title: String {
            switch self {
            case .concept: "Concept"
            case .gap: "Gap"
            case .question: "Check"
            case .reviewCard: "Review State"
            case .reviewEvent: "Review Evidence"
            }
        }

        public var layer: Layer {
            switch self {
            case .concept: .knowledge
            case .gap, .question: .assessment
            case .reviewCard, .reviewEvent: .learner
            }
        }
    }

    public enum EvidenceStatus: String, CaseIterable, Codable, Sendable {
        case untested
        case fragile
        case developing
        case stable

        public var title: String { rawValue.capitalized }
    }

    public var id: String
    public var title: String
    public var subtitle: String
    public var kind: Kind
    public var weight: Int
    public var evidenceStatus: EvidenceStatus
    public var evidenceSummary: String
    public var reviewCount: Int

    public init(
        id: String,
        title: String,
        subtitle: String,
        kind: Kind,
        weight: Int,
        evidenceStatus: EvidenceStatus = .untested,
        evidenceSummary: String = "No review evidence",
        reviewCount: Int = 0
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.kind = kind
        self.weight = weight
        self.evidenceStatus = evidenceStatus
        self.evidenceSummary = evidenceSummary
        self.reviewCount = reviewCount
    }

    public var layer: Layer { kind.layer }

    public static func conceptID(_ id: String) -> String { "concept:\(id)" }
    public static func gapID(_ id: String) -> String { "gap:\(id)" }
    public static func questionID(_ id: String) -> String { "question:\(id)" }
    public static func reviewCardID(_ questionID: String) -> String { "card:\(questionID)" }
    public static func reviewEventID(_ id: UUID) -> String { "event:\(id.uuidString.lowercased())" }

    public var rawKnowledgeID: String {
        id.components(separatedBy: ":").dropFirst().joined(separator: ":")
    }
}

public struct KnowledgeGraphLink: Identifiable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case prerequisite
        case partOf
        case contrastsWith
        case enables
        case gapConcept
        case questionConcept
        case cardQuestion
        case eventCard
        case eventConcept

        init(_ relationshipKind: KnowledgeRelationshipKind) {
            switch relationshipKind {
            case .prerequisite: self = .prerequisite
            case .partOf: self = .partOf
            case .contrastsWith: self = .contrastsWith
            case .enables: self = .enables
            }
        }

        public var title: String {
            switch self {
            case .prerequisite: "Prerequisite"
            case .partOf: "Part of"
            case .contrastsWith: "Contrasts with"
            case .enables: "Enables"
            case .gapConcept: "Gap evidence"
            case .questionConcept: "Assesses"
            case .cardQuestion: "Schedules"
            case .eventCard: "Updates state"
            case .eventConcept: "Learner evidence"
            }
        }

        public var isAuthoredKnowledgeRelationship: Bool {
            switch self {
            case .prerequisite, .partOf, .contrastsWith, .enables: true
            case .gapConcept, .questionConcept, .cardQuestion, .eventCard, .eventConcept: false
            }
        }
    }

    public var id: String
    public var sourceID: String
    public var targetID: String
    public var kind: Kind
    public var rationale: String?
    public var sourceRefs: [String]

    public init(
        id: String? = nil,
        sourceID: String,
        targetID: String,
        kind: Kind,
        rationale: String? = nil,
        sourceRefs: [String] = []
    ) {
        self.sourceID = sourceID
        self.targetID = targetID
        self.kind = kind
        self.rationale = rationale
        self.sourceRefs = sourceRefs
        self.id = id ?? "\(kind.rawValue):\(sourceID)->\(targetID)"
    }
}

public enum KnowledgeGraphLayout {
    public static func positions(for graph: KnowledgeGraph, in size: CGSize) -> [KnowledgeGraphNode.ID: CGPoint] {
        guard graph.nodes.isEmpty == false else { return [:] }
        guard size.width > 0, size.height > 0 else { return [:] }

        let concepts = graph.nodes.filter { $0.kind == .concept }
        guard concepts.isEmpty == false else {
            return radialPositions(for: graph.nodes, in: size)
        }

        let horizontalPadding: CGFloat = min(92, max(42, size.width * 0.08))
        let conceptY = size.height * 0.42
        var positions: [KnowledgeGraphNode.ID: CGPoint] = [:]

        for (index, node) in concepts.enumerated() {
            let x: CGFloat
            if concepts.count == 1 {
                x = size.width / 2
            } else {
                let availableWidth = max(1, size.width - horizontalPadding * 2)
                x = horizontalPadding + availableWidth * CGFloat(index) / CGFloat(concepts.count - 1)
            }
            let verticalWave = CGFloat((index % 2 == 0) ? -1 : 1) * min(22, size.height * 0.03)
            positions[node.id] = CGPoint(x: x, y: conceptY + verticalWave)
        }

        place(
            graph.nodes.filter { $0.kind == .gap },
            at: size.height * 0.16,
            rowSpacing: 38,
            graph: graph,
            size: size,
            horizontalPadding: horizontalPadding,
            positions: &positions
        )
        place(
            graph.nodes.filter { $0.kind == .question },
            at: size.height * 0.61,
            rowSpacing: 42,
            graph: graph,
            size: size,
            horizontalPadding: horizontalPadding,
            positions: &positions
        )
        place(
            graph.nodes.filter { $0.kind == .reviewCard },
            at: size.height * 0.78,
            rowSpacing: 32,
            graph: graph,
            size: size,
            horizontalPadding: horizontalPadding,
            positions: &positions
        )
        place(
            graph.nodes.filter { $0.kind == .reviewEvent },
            at: size.height * 0.91,
            rowSpacing: 24,
            graph: graph,
            size: size,
            horizontalPadding: horizontalPadding,
            positions: &positions
        )

        return positions
    }

    private static func place(
        _ nodes: [KnowledgeGraphNode],
        at baseY: CGFloat,
        rowSpacing: CGFloat,
        graph: KnowledgeGraph,
        size: CGSize,
        horizontalPadding: CGFloat,
        positions: inout [KnowledgeGraphNode.ID: CGPoint]
    ) {
        for (index, node) in nodes.enumerated() {
            let anchorX = linkedPositionCenterX(for: node.id, links: graph.links, positions: positions)
                ?? orbitX(index: index, count: nodes.count, size: size)
            let offset = CGFloat((index % 5) - 2) * 22
            positions[node.id] = CGPoint(
                x: clamp(anchorX + offset, min: horizontalPadding, max: size.width - horizontalPadding),
                y: min(size.height - 30, baseY + CGFloat(index % 3) * rowSpacing)
            )
        }
    }

    private static func linkedPositionCenterX(
        for nodeID: KnowledgeGraphNode.ID,
        links: [KnowledgeGraphLink],
        positions: [KnowledgeGraphNode.ID: CGPoint]
    ) -> CGFloat? {
        let linkedXs = links.compactMap { link -> CGFloat? in
            guard link.sourceID == nodeID || link.targetID == nodeID else { return nil }
            let otherID = link.sourceID == nodeID ? link.targetID : link.sourceID
            return positions[otherID]?.x
        }
        guard linkedXs.isEmpty == false else { return nil }
        return linkedXs.reduce(0, +) / CGFloat(linkedXs.count)
    }

    private static func radialPositions(
        for nodes: [KnowledgeGraphNode],
        in size: CGSize
    ) -> [KnowledgeGraphNode.ID: CGPoint] {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let radius = min(size.width, size.height) * 0.32
        var positions: [KnowledgeGraphNode.ID: CGPoint] = [:]

        for (index, node) in nodes.enumerated() {
            let angle = (CGFloat(index) / CGFloat(max(1, nodes.count))) * CGFloat.pi * 2 - CGFloat.pi / 2
            positions[node.id] = CGPoint(
                x: center.x + cos(angle) * radius,
                y: center.y + sin(angle) * radius
            )
        }

        return positions
    }

    private static func orbitX(index: Int, count: Int, size: CGSize) -> CGFloat {
        guard count > 1 else { return size.width / 2 }
        return size.width * (0.2 + 0.6 * CGFloat(index) / CGFloat(count - 1))
    }

    private static func clamp(_ value: CGFloat, min lowerBound: CGFloat, max upperBound: CGFloat) -> CGFloat {
        Swift.min(Swift.max(value, lowerBound), upperBound)
    }
}

public extension QuestionKind {
    var title: String {
        switch self {
        case .multipleChoice: "Multiple choice"
        case .freeRecall: "Free recall"
        case .explain: "Explain"
        case .predict: "Predict"
        case .compare: "Compare"
        case .trace: "Trace"
        case .debug: "Debug"
        }
    }
}

public extension TransferLevel {
    var title: String { rawValue.capitalized }
}
