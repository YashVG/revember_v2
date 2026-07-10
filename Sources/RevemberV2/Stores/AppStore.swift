import Foundation
import SwiftUI

public struct DueReviewItem: Identifiable, Equatable, Sendable {
    public let topic: KnowledgeTopic
    public let question: Question
    public let dueAt: Date?
    public let isNew: Bool
    public let isRevised: Bool

    public init(
        topic: KnowledgeTopic,
        question: Question,
        dueAt: Date?,
        isNew: Bool,
        isRevised: Bool = false
    ) {
        self.topic = topic
        self.question = question
        self.dueAt = dueAt
        self.isNew = isNew
        self.isRevised = isRevised
    }

    public var id: String {
        "\(topic.id)::\(question.id)"
    }

    public var topicID: String { topic.id }
    public var questionID: String { question.id }
}

public struct ReviewSession: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let items: [DueReviewItem]
    public let startedAt: Date
    public let targetDuration: TimeInterval
    public let estimatedSecondsPerQuestion: TimeInterval

    public init(
        id: UUID = UUID(),
        items: [DueReviewItem],
        startedAt: Date,
        targetDuration: TimeInterval,
        estimatedSecondsPerQuestion: TimeInterval
    ) {
        self.id = id
        self.items = items
        self.startedAt = startedAt
        self.targetDuration = targetDuration
        self.estimatedSecondsPerQuestion = estimatedSecondsPerQuestion
    }

    public var estimatedDuration: TimeInterval {
        min(targetDuration, Double(items.count) * estimatedSecondsPerQuestion)
    }
}

public struct ReviewCommitResult: Equatable, Sendable {
    public let event: ReviewEvent
    public let cardState: ReviewCardState
    public let wasInserted: Bool

    public init(event: ReviewEvent, cardState: ReviewCardState, wasInserted: Bool) {
        self.event = event
        self.cardState = cardState
        self.wasInserted = wasInserted
    }
}

@MainActor
public final class AppStore: ObservableObject {
    @Published public var topics: [KnowledgeTopic] = []
    @Published public var selectedTopicID: String?
    @Published public var progress = ProgressRecord()
    @Published public var errorMessage: String?
    @Published public var knowledgeRootPath: String

    private let knowledgeLoader: KnowledgeLoading
    private let progressStore: ProgressStoring
    private let userDefaults: UserDefaults
    private let reviewScheduler: any ReviewScheduling
    private let knowledgeWatcher: (any KnowledgeWatching)?

    public init(
        knowledgeLoader: KnowledgeLoading = KnowledgeLoader(),
        progressStore: ProgressStoring = ProgressFileStore(),
        knowledgeRoot: URL = KnowledgeLoader.defaultKnowledgeRoot,
        userDefaults: UserDefaults = .standard,
        reviewScheduler: any ReviewScheduling = ReviewScheduler(),
        knowledgeWatcher: (any KnowledgeWatching)? = KnowledgeFolderWatcher()
    ) {
        self.knowledgeLoader = knowledgeLoader
        self.progressStore = progressStore
        self.userDefaults = userDefaults
        self.reviewScheduler = reviewScheduler
        self.knowledgeWatcher = knowledgeWatcher
        self.knowledgeRootPath = RevemberPaths.configuredKnowledgeRoot?.path
            ?? userDefaults.string(forKey: "knowledgeRootPath")
            ?? knowledgeRoot.path
        reload()
        loadProgress()
        startKnowledgeWatcher()
    }

    public var selectedTopic: KnowledgeTopic? {
        guard let selectedTopicID else { return topics.first }
        return topics.first { $0.id == selectedTopicID } ?? topics.first
    }

    public var knowledgeRoot: URL {
        URL(fileURLWithPath: knowledgeRootPath, isDirectory: true)
    }

    public var dueReviewCount: Int {
        dueReviewItems().count
    }

    public var nextDueAt: Date? {
        topics.flatMap { topic in
            topic.questions.compactMap { question in
                guard question.retiredAt == nil else { return nil }
                guard let state = progress.cardState(topicID: topic.id, questionID: question.id),
                      state.questionRevision == question.revision
                else { return nil }
                return state.dueAt
            }
        }
            .min()
    }

    public func reload() {
        do {
            let loadedTopics = try knowledgeLoader.loadTopics(from: knowledgeRoot)
            topics = loadedTopics
            if selectedTopicID == nil || loadedTopics.contains(where: { $0.id == selectedTopicID }) == false {
                selectedTopicID = loadedTopics.first?.id
            }
            errorMessage = nil
        } catch {
            // Keep the last known-good in-memory snapshot while an editor is mid-save.
            errorMessage = error.localizedDescription
        }
    }

    public func loadProgress() {
        do {
            progress = try progressStore.load()
        } catch {
            progress = ProgressRecord()
            errorMessage = "Could not load progress: \(error.localizedDescription)"
        }
    }

    /// Replaces only the derived schedule cache using the injected algorithm. This is
    /// intentionally opt-in: opening an older progress file must never silently
    /// reinterpret its due dates under a different scheduler.
    @discardableResult
    public func rebuildReviewCardStates(using scheduler: any ReviewScheduling) -> Int {
        var candidate = progress
        let rebuiltCount = candidate.rebuildReviewCardStates(using: scheduler)
        guard rebuiltCount > 0 else { return 0 }
        return persist(candidate) ? rebuiltCount : 0
    }

    public func setKnowledgeRoot(_ url: URL) {
        knowledgeRootPath = url.path
        userDefaults.set(url.path, forKey: "knowledgeRootPath")
        reload()
        startKnowledgeWatcher()
    }

    public func resetKnowledgeRoot() {
        setKnowledgeRoot(KnowledgeLoader.defaultKnowledgeRoot)
    }

    /// Legacy immediate-answer API retained for source and data compatibility.
    /// New review UI should call `commitReview` after an effort rating is chosen.
    @discardableResult
    public func answer(topic: KnowledgeTopic, question: Question, choice: AnswerChoice) -> Bool {
        var candidate = progress
        let isCorrect = candidate.recordAnswer(topicID: topic.id, question: question, choice: choice)
        persist(candidate)
        return isCorrect
    }

    /// Persists one rated answer transactionally. Reusing an event ID is idempotent.
    @discardableResult
    public func commitReview(
        topic: KnowledgeTopic,
        question: Question,
        choice: AnswerChoice,
        rating: ReviewRating,
        eventID: UUID = UUID(),
        reviewedAt: Date? = nil
    ) -> ReviewCommitResult? {
        guard let currentTopic = topics.first(where: { $0.id == topic.id }),
              let currentQuestion = currentTopic.questions.first(where: {
                  $0.id == question.id && $0.retiredAt == nil
              }),
              currentQuestion.revision == question.revision,
              let currentChoice = currentQuestion.choices.first(where: { $0.id == choice.id }),
              currentChoice == choice
        else {
            errorMessage = "This check changed while it was open. Start a fresh review before saving evidence."
            return nil
        }

        let effectiveRating: ReviewRating = currentChoice.isCorrect ? rating : .missed
        let event = ReviewEvent(
            id: eventID,
            topicID: currentTopic.id,
            questionID: currentQuestion.id,
            questionRevision: currentQuestion.revision,
            questionKind: currentQuestion.kind,
            transferLevel: currentQuestion.transferLevel,
            questionPrompt: currentQuestion.prompt,
            choiceID: currentChoice.id,
            selectedChoiceText: currentChoice.text,
            correctChoiceID: currentQuestion.correctChoice?.id,
            correctChoiceText: currentQuestion.correctChoice?.text,
            isCorrect: currentChoice.isCorrect,
            rating: effectiveRating,
            conceptIDs: currentQuestion.conceptIDs,
            gapTags: currentQuestion.gapTags,
            misconceptionIDs: currentChoice.misconceptionID.map { [$0] } ?? [],
            sourceRefs: currentQuestion.sourceRefs,
            reviewedAt: reviewedAt ?? reviewScheduler.now
        )

        if let storedEvent = progress.reviewEvents.first(where: { $0.id == eventID }) {
            guard storedEvent == event else {
                errorMessage = "Review event ID conflict: \(eventID.uuidString.lowercased()) already identifies a different retrieval."
                return nil
            }
            guard let state = progress.cardState(
                topicID: storedEvent.topicID,
                questionID: storedEvent.questionID
            ), state.questionRevision == storedEvent.questionRevision else {
                errorMessage = "Stored review event is historical and has no matching current scheduler state."
                return nil
            }
            return ReviewCommitResult(event: storedEvent, cardState: state, wasInserted: false)
        }

        var candidate = progress
        guard candidate.recordReview(event, scheduler: reviewScheduler),
              let state = candidate.cardState(topicID: topic.id, questionID: question.id)
        else {
            return nil
        }

        guard persist(candidate) else { return nil }
        return ReviewCommitResult(event: event, cardState: state, wasInserted: true)
    }

    @discardableResult
    public func commitReview(
        item: DueReviewItem,
        choice: AnswerChoice,
        rating: ReviewRating,
        eventID: UUID = UUID(),
        reviewedAt: Date? = nil
    ) -> ReviewCommitResult? {
        commitReview(
            topic: item.topic,
            question: item.question,
            choice: choice,
            rating: rating,
            eventID: eventID,
            reviewedAt: reviewedAt
        )
    }

    public func dueReviewItems(at date: Date? = nil) -> [DueReviewItem] {
        let date = date ?? reviewScheduler.now
        var scheduled: [DueReviewItem] = []
        var revisedItems: [DueReviewItem] = []
        var newItems: [DueReviewItem] = []

        for topic in topics {
            for question in topic.questions where question.retiredAt == nil {
                if let state = progress.cardState(topicID: topic.id, questionID: question.id) {
                    if state.questionRevision != question.revision {
                        revisedItems.append(
                            DueReviewItem(
                                topic: topic,
                                question: question,
                                dueAt: nil,
                                isNew: false,
                                isRevised: true
                            )
                        )
                    } else if state.dueAt <= date {
                        scheduled.append(
                            DueReviewItem(topic: topic, question: question, dueAt: state.dueAt, isNew: false)
                        )
                    }
                } else {
                    newItems.append(DueReviewItem(topic: topic, question: question, dueAt: nil, isNew: true))
                }
            }
        }

        scheduled.sort {
            if $0.dueAt != $1.dueAt {
                return ($0.dueAt ?? .distantPast) < ($1.dueAt ?? .distantPast)
            }
            return $0.id < $1.id
        }
        revisedItems.sort { $0.id < $1.id }
        return scheduled + revisedItems + newItems
    }

    public func makeReviewSession(
        duration: TimeInterval = 180,
        estimatedSecondsPerQuestion: TimeInterval = 45,
        at date: Date? = nil
    ) -> ReviewSession {
        let startedAt = date ?? reviewScheduler.now
        guard duration > 0, estimatedSecondsPerQuestion > 0 else {
            return ReviewSession(
                items: [],
                startedAt: startedAt,
                targetDuration: max(0, duration),
                estimatedSecondsPerQuestion: max(0, estimatedSecondsPerQuestion)
            )
        }

        let capacity = max(1, Int(duration / estimatedSecondsPerQuestion))
        return ReviewSession(
            items: Array(dueReviewItems(at: startedAt).prefix(capacity)),
            startedAt: startedAt,
            targetDuration: duration,
            estimatedSecondsPerQuestion: estimatedSecondsPerQuestion
        )
    }

    public func progressSummary(for topic: KnowledgeTopic) -> String {
        let evidence = currentEvidence(for: topic)
        let attempts = evidence.attempts
        guard attempts > 0 else { return "No check-ins yet" }
        let score = Int((evidence.score * 100).rounded())
        return "\(score)% across \(attempts) current answers"
    }

    public func currentScore(for topic: KnowledgeTopic) -> Double {
        currentEvidence(for: topic).score
    }

    public func weakConcepts(for topic: KnowledgeTopic) -> [Concept] {
        let graph = KnowledgeGraph(topic: topic, progress: progress)
        let evidenceBacked = topic.concepts.filter {
            let status = graph.evidence(forConceptID: $0.id)
            return status == .fragile || status == .developing
        }
        guard evidenceBacked.isEmpty else { return evidenceBacked }
        guard let topicProgress = progress.topics[topic.id] else { return [] }
        return topicProgress.weakConceptIDs
            .sorted { $0.value > $1.value }
            .compactMap { entry in
                guard let concept = topic.concept(withID: entry.key) else { return nil }
                let linkedQuestions = topic.questions.filter {
                    $0.retiredAt == nil && $0.conceptIDs.contains(concept.id)
                }
                guard linkedQuestions.allSatisfy({ $0.revision == 1 }) else { return nil }
                return concept
            }
    }

    private func currentEvidence(for topic: KnowledgeTopic) -> (attempts: Int, correct: Int, score: Double) {
        var attempts = 0
        var correct = 0

        for question in topic.questions where question.retiredAt == nil {
            let events = progress.events(forQuestionID: question.id, topicID: topic.id)
                .filter { $0.questionRevision == question.revision }
            if events.isEmpty == false {
                attempts += events.count
                correct += events.filter(\.isCorrect).count
            } else if question.revision == 1,
                      let legacy = progress.topics[topic.id]?.attemptsByQuestionID[question.id] {
                attempts += legacy.attempts
                correct += legacy.correctAttempts
            }
        }

        return (attempts, correct, attempts > 0 ? Double(correct) / Double(attempts) : 0)
    }

    private func startKnowledgeWatcher() {
        guard let knowledgeWatcher else { return }
        do {
            try knowledgeWatcher.start(watching: knowledgeRoot) { [weak self] in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.reload()
                    // Reattach in case an editor replaced the watched directory atomically.
                    self.startKnowledgeWatcher()
                }
            }
        } catch {
            if topics.isEmpty {
                errorMessage = "Live reload unavailable: \(error.localizedDescription)"
            }
        }
    }

    @discardableResult
    private func persist(_ candidate: ProgressRecord) -> Bool {
        do {
            try progressStore.save(candidate)
            progress = candidate
            errorMessage = nil
            return true
        } catch {
            errorMessage = "Could not save progress: \(error.localizedDescription)"
            return false
        }
    }
}
