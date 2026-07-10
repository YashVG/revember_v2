import Foundation
import Testing
@testable import RevemberV2Core

@Suite("AppStore review queue", .serialized)
@MainActor
struct AppStoreReviewTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test("due queue prioritizes overdue cards then unseen questions")
    func dueQueueOrdering() {
        let topic = sampleTopic(questionCount: 5)
        var progress = ProgressRecord()
        let overdueQuestion = topic.questions[0]
        let futureQuestion = topic.questions[1]
        let overdueAt = now.addingTimeInterval(-86_400)
        let futureReviewedAt = now
        progress.recordReview(
            event(topic: topic, question: overdueQuestion, rating: .missed, reviewedAt: overdueAt),
            scheduler: ReviewScheduler(clock: FixedReviewClock(overdueAt))
        )
        progress.recordReview(
            event(topic: topic, question: futureQuestion, rating: .good, reviewedAt: futureReviewedAt),
            scheduler: ReviewScheduler(clock: FixedReviewClock(futureReviewedAt))
        )
        let progressStore = MemoryProgressStore(progress)
        let store = makeStore(topic: topic, progressStore: progressStore)

        let due = store.dueReviewItems(at: now)
        let session = store.makeReviewSession(duration: 180, estimatedSecondsPerQuestion: 60, at: now)
        let remainingItemsAreNew = due.dropFirst().allSatisfy { $0.isNew }

        #expect(due.map(\.questionID) == ["q0", "q2", "q3", "q4"])
        #expect(due[0].isNew == false)
        #expect(remainingItemsAreNew)
        #expect(store.dueReviewCount == 4)
        #expect(store.nextDueAt == progress.cardState(topicID: topic.id, questionID: "q0")?.dueAt)
        #expect(session.items.map(\.questionID) == ["q0", "q2", "q3"])
        #expect(session.estimatedDuration == 180)
    }

    @Test("commit is idempotent and saves only the first use of an event ID")
    func duplicateCommit() {
        let topic = sampleTopic(questionCount: 1)
        let progressStore = MemoryProgressStore()
        let store = makeStore(topic: topic, progressStore: progressStore)
        let eventID = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
        let question = topic.questions[0]

        let first = store.commitReview(
            topic: topic,
            question: question,
            choice: question.choices[0],
            rating: .good,
            eventID: eventID,
            reviewedAt: now
        )
        let duplicate = store.commitReview(
            topic: topic,
            question: question,
            choice: question.choices[0],
            rating: .good,
            eventID: eventID,
            reviewedAt: now
        )

        #expect(first?.wasInserted == true)
        #expect(duplicate?.wasInserted == false)
        #expect(progressStore.saveCount == 1)
        #expect(store.progress.reviewEvents.count == 1)
        #expect(store.progress.attempts(for: topic.id) == 1)
        #expect(store.progress.cardState(topicID: topic.id, questionID: question.id)?.reviews == 1)
    }

    @Test("a failed save does not mutate in-memory progress")
    func failedSaveIsTransactional() {
        let topic = sampleTopic(questionCount: 1)
        let progressStore = MemoryProgressStore()
        progressStore.shouldFailSaving = true
        let store = makeStore(topic: topic, progressStore: progressStore)
        let question = topic.questions[0]

        let result = store.commitReview(
            topic: topic,
            question: question,
            choice: question.choices[0],
            rating: .easy,
            reviewedAt: now
        )

        #expect(result == nil)
        #expect(store.progress.reviewEvents.isEmpty)
        #expect(store.progress.attempts(for: topic.id) == 0)
        #expect(store.errorMessage?.contains("Could not save progress") == true)
    }

    @Test("incorrect answers are snapshotted and scheduled as missed")
    func incorrectEasyIsNormalized() {
        let topic = sampleTopic(questionCount: 1)
        let progressStore = MemoryProgressStore()
        let store = makeStore(topic: topic, progressStore: progressStore)
        let question = topic.questions[0]
        let wrongChoice = question.choices[1]

        let result = store.commitReview(
            topic: topic,
            question: question,
            choice: wrongChoice,
            rating: .easy,
            reviewedAt: now
        )

        #expect(result?.event.rating == .missed)
        #expect(result?.event.questionRevision == question.revision)
        #expect(result?.event.questionPrompt == question.prompt)
        #expect(result?.event.selectedChoiceText == wrongChoice.text)
        #expect(result?.event.correctChoiceText == question.correctChoice?.text)
        #expect(result?.event.misconceptionIDs == ["wrong-model"])
        #expect(result?.cardState.questionRevision == question.revision)
        #expect(abs((result?.cardState.intervalDays ?? 0) - 15 / ReviewScheduler.minutesPerDay) < 0.000_001)
    }

    @Test("a revised question is queued for fresh evidence")
    func revisedQuestionReturnsToQueue() {
        var topic = sampleTopic(questionCount: 1)
        let oldQuestion = topic.questions[0]
        var progress = ProgressRecord()
        progress.recordReview(
            event(topic: topic, question: oldQuestion, rating: .easy, reviewedAt: now),
            scheduler: ReviewScheduler(clock: FixedReviewClock(now))
        )
        topic.questions[0].revision = 2
        let store = makeStore(topic: topic, progressStore: MemoryProgressStore(progress))

        let item = store.dueReviewItems(at: now).first

        #expect(item?.questionID == oldQuestion.id)
        #expect(item?.isRevised == true)
        #expect(item?.isNew == false)
        #expect(item?.dueAt == nil)
        #expect(store.nextDueAt == nil)
        #expect(store.currentScore(for: topic) == 0)
        #expect(store.progressSummary(for: topic) == "No check-ins yet")
    }

    @Test("reusing an event ID with a different payload is rejected")
    func duplicateIDPayloadConflict() {
        let topic = sampleTopic(questionCount: 1)
        let progressStore = MemoryProgressStore()
        let store = makeStore(topic: topic, progressStore: progressStore)
        let question = topic.questions[0]
        let eventID = UUID(uuidString: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")!

        let first = store.commitReview(
            topic: topic,
            question: question,
            choice: question.choices[0],
            rating: .good,
            eventID: eventID,
            reviewedAt: now
        )
        let conflict = store.commitReview(
            topic: topic,
            question: question,
            choice: question.choices[1],
            rating: .missed,
            eventID: eventID,
            reviewedAt: now
        )

        #expect(first != nil)
        #expect(conflict == nil)
        #expect(progressStore.saveCount == 1)
        #expect(store.progress.reviewEvents.count == 1)
        #expect(store.errorMessage?.contains("ID conflict") == true)
    }

    @Test("a card revised while open cannot write stale evidence")
    func staleOpenCardIsRejected() {
        var topic = sampleTopic(questionCount: 1)
        let progressStore = MemoryProgressStore()
        let store = makeStore(topic: topic, progressStore: progressStore)
        let staleQuestion = topic.questions[0]
        topic.questions[0].revision = 2
        store.topics = [topic]

        let result = store.commitReview(
            topic: KnowledgeTopic(
                id: topic.id,
                title: topic.title,
                summary: topic.summary,
                concepts: topic.concepts,
                gaps: topic.gaps,
                questions: [staleQuestion]
            ),
            question: staleQuestion,
            choice: staleQuestion.choices[0],
            rating: .good,
            reviewedAt: now
        )

        #expect(result == nil)
        #expect(progressStore.saveCount == 0)
        #expect(store.errorMessage?.contains("changed while it was open") == true)
    }

    @Test("explicit scheduler replay persists a replacement cache without changing evidence")
    func explicitSchedulerReplayIsTransactional() {
        let topic = sampleTopic(questionCount: 1)
        let question = topic.questions[0]
        var progress = ProgressRecord()
        let firstEvent = event(topic: topic, question: question, rating: .good, reviewedAt: now)
        let didRecord = progress.recordReview(
            firstEvent,
            scheduler: ReviewScheduler(clock: FixedReviewClock(now))
        )
        #expect(didRecord)
        let progressStore = MemoryProgressStore(progress)
        let store = makeStore(topic: topic, progressStore: progressStore)
        let immutableEvents = store.progress.reviewEvents

        let rebuilt = store.rebuildReviewCardStates(using: ReplacementScheduler(now: now))
        let state = store.progress.cardState(topicID: topic.id, questionID: question.id)

        #expect(rebuilt == 1)
        #expect(progressStore.saveCount == 1)
        #expect(store.progress.reviewEvents == immutableEvents)
        #expect(state?.schedulerVersion == "fsrs-ready-test-v1")
        #expect(state?.intervalDays == 9)

        progressStore.shouldFailSaving = true
        let beforeFailure = store.progress
        let failedRebuild = store.rebuildReviewCardStates(using: ReplacementScheduler(now: now))

        #expect(failedRebuild == 0)
        #expect(store.progress == beforeFailure)
        #expect(store.errorMessage?.contains("Could not save progress") == true)
    }

    private func makeStore(topic: KnowledgeTopic, progressStore: MemoryProgressStore) -> AppStore {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        return AppStore(
            knowledgeLoader: StubKnowledgeLoader(topics: [topic]),
            progressStore: progressStore,
            knowledgeRoot: URL(fileURLWithPath: "/tmp/revember-tests", isDirectory: true),
            userDefaults: defaults,
            reviewScheduler: ReviewScheduler(clock: FixedReviewClock(now)),
            knowledgeWatcher: nil
        )
    }

    private func event(
        topic: KnowledgeTopic,
        question: Question,
        rating: ReviewRating,
        reviewedAt: Date
    ) -> ReviewEvent {
        ReviewEvent(
            topicID: topic.id,
            questionID: question.id,
            questionRevision: question.revision,
            choiceID: question.choices[0].id,
            isCorrect: true,
            rating: rating,
            conceptIDs: question.conceptIDs,
            gapTags: question.gapTags,
            reviewedAt: reviewedAt
        )
    }

    private func sampleTopic(questionCount: Int) -> KnowledgeTopic {
        KnowledgeTopic(
            id: "ble",
            title: "BLE",
            summary: "Fundamentals",
            concepts: [],
            gaps: [],
            questions: (0..<questionCount).map { index in
                Question(
                    id: "q\(index)",
                    prompt: "Question \(index)",
                    difficulty: .intro,
                    conceptIDs: ["concept-\(index)"],
                    gapTags: ["gap-\(index)"],
                    choices: [
                        AnswerChoice(id: "correct", text: "Correct", isCorrect: true),
                        AnswerChoice(
                            id: "wrong",
                            text: "Wrong",
                            isCorrect: false,
                            rationale: "This reflects the wrong model.",
                            misconceptionID: "wrong-model"
                        )
                    ],
                    explanation: "Because."
                )
            }
        )
    }
}

private struct StubKnowledgeLoader: KnowledgeLoading {
    let topics: [KnowledgeTopic]

    func loadTopics(from knowledgeRoot: URL) throws -> [KnowledgeTopic] {
        topics
    }
}

private final class MemoryProgressStore: ProgressStoring {
    var stored: ProgressRecord
    var saveCount = 0
    var shouldFailSaving = false

    init(_ stored: ProgressRecord = ProgressRecord()) {
        self.stored = stored
    }

    func load() throws -> ProgressRecord {
        stored
    }

    func save(_ progress: ProgressRecord) throws {
        if shouldFailSaving {
            throw CocoaError(.fileWriteUnknown)
        }
        stored = progress
        saveCount += 1
    }
}

private struct ReplacementScheduler: ReviewScheduling {
    let now: Date
    let schedulerVersion = "fsrs-ready-test-v1"

    func schedule(
        previous: ReviewCardState?,
        rating: ReviewRating,
        reviewedAt: Date?
    ) -> ReviewCardState {
        let reviewedAt = reviewedAt ?? now
        let interval = 9.0
        return ReviewCardState(
            schedulerVersion: "ignored-by-app-store",
            dueAt: reviewedAt.addingTimeInterval(interval * ReviewScheduler.secondsPerDay),
            intervalDays: interval,
            stability: interval,
            difficulty: 4,
            lastRating: rating,
            lapses: previous?.lapses ?? 0,
            reviews: (previous?.reviews ?? 0) + 1,
            lastReviewedAt: reviewedAt
        )
    }
}
