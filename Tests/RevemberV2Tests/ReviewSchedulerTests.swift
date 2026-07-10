import Foundation
import Testing
@testable import RevemberV2Core

@Suite("Review scheduler")
struct ReviewSchedulerTests {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)

    @Test("new cards use the documented intervals", arguments: [
        (ReviewRating.missed, 15 / ReviewScheduler.minutesPerDay),
        (.hard, 1),
        (.good, 2),
        (.easy, 4)
    ])
    func newCardIntervals(rating: ReviewRating, expectedDays: Double) {
        let scheduler = ReviewScheduler(clock: FixedReviewClock(start))

        let state = scheduler.schedule(previous: nil, rating: rating)

        #expect(abs(state.intervalDays - expectedDays) < 0.000_001)
        #expect(abs(state.dueAt.timeIntervalSince(start) - expectedDays * 86_400) < 0.001)
        #expect(state.lastReviewedAt == start)
        #expect(state.lastRating == rating)
        #expect(state.schedulerVersion == ReviewScheduler.algorithmVersion)
        #expect(state.reviews == 1)
        #expect(state.lapses == (rating == .missed ? 1 : 0))
    }

    @Test("review cards use transparent multipliers", arguments: [
        (ReviewRating.missed, 1.0),
        (.hard, 4.8),
        (.good, 8.8),
        (.easy, 12.0)
    ])
    func reviewIntervals(rating: ReviewRating, expectedDays: Double) {
        let previous = ReviewCardState(
            dueAt: start,
            intervalDays: 4,
            stability: 4,
            difficulty: 5,
            lastRating: .good,
            lapses: 2,
            reviews: 7,
            lastReviewedAt: start.addingTimeInterval(-86_400)
        )
        let reviewedAt = start.addingTimeInterval(500)

        let state = ReviewScheduler().schedule(previous: previous, rating: rating, reviewedAt: reviewedAt)

        #expect(abs(state.intervalDays - expectedDays) < 0.000_001)
        #expect(abs(state.dueAt.timeIntervalSince(reviewedAt) - expectedDays * 86_400) < 0.001)
        #expect(state.reviews == 8)
        #expect(state.lapses == 2 + (rating == .missed ? 1 : 0))
    }

    @Test("hard reviews never become shorter than one day")
    func hardMinimum() {
        let previous = ReviewCardState(
            dueAt: start,
            intervalDays: 15 / ReviewScheduler.minutesPerDay,
            stability: 0,
            difficulty: 5
        )

        let state = ReviewScheduler().schedule(previous: previous, rating: .hard, reviewedAt: start)

        #expect(state.intervalDays == 1)
    }

    @Test("schedule presentation reports the committed state rather than a fixed rating label")
    func schedulePresentationUsesCommittedState() {
        let dueAt = start.addingTimeInterval(8.8 * ReviewScheduler.secondsPerDay)
        let state = ReviewCardState(
            dueAt: dueAt,
            intervalDays: 8.8,
            stability: 8.8,
            difficulty: 4
        )

        let presentation = ReviewSchedulePresentation(cardState: state)

        #expect(presentation.dueAt == dueAt)
        #expect(presentation.intervalDays == 8.8)
        #expect(presentation.intervalText == "8.8 days interval")
    }

    @Test("short committed intervals are shown in minutes")
    func schedulePresentationUsesMinutesForShortIntervals() {
        let state = ReviewCardState(
            dueAt: start.addingTimeInterval(15 * 60),
            intervalDays: 15 / ReviewScheduler.minutesPerDay,
            stability: 15 / ReviewScheduler.minutesPerDay,
            difficulty: 6
        )

        #expect(ReviewSchedulePresentation(cardState: state).intervalText == "15 min interval")
    }

    @Test("a late-arriving event replays the card ledger in review-time order")
    func chronologicalReplay() {
        let scheduler = ReviewScheduler(clock: FixedReviewClock(start))
        let earlier = reviewEvent(
            id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            rating: .good,
            reviewedAt: start
        )
        let later = reviewEvent(
            id: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
            rating: .good,
            reviewedAt: start.addingTimeInterval(2 * ReviewScheduler.secondsPerDay)
        )
        var progress = ProgressRecord()

        let didRecordLater = progress.recordReview(later, scheduler: scheduler)
        #expect(didRecordLater)
        #expect(abs((progress.cardState(topicID: "ble", questionID: "q1")?.intervalDays ?? 0) - 2) < 0.000_001)

        let didRecordEarlier = progress.recordReview(earlier, scheduler: scheduler)
        #expect(didRecordEarlier)
        let state = progress.cardState(topicID: "ble", questionID: "q1")

        #expect(abs((state?.intervalDays ?? 0) - 4.4) < 0.000_001)
        #expect(abs((state?.dueAt.timeIntervalSince(later.reviewedAt) ?? 0) - 4.4 * ReviewScheduler.secondsPerDay) < 0.001)
        #expect(progress.events(forQuestionID: "q1", topicID: "ble").map(\.id) == [earlier.id, later.id])
        #expect(progress.reviewEvents.map(\.id) == [later.id, earlier.id])
        #expect(progress.topics["ble"]?.lastReviewedAt == later.reviewedAt)
    }

    @Test("a replacement scheduler rebuilds only derived card state from immutable history")
    func explicitSchedulerReplay() {
        let first = reviewEvent(
            id: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            rating: .good,
            reviewedAt: start
        )
        let second = reviewEvent(
            id: UUID(uuidString: "44444444-4444-4444-8444-444444444444")!,
            rating: .easy,
            reviewedAt: start.addingTimeInterval(ReviewScheduler.secondsPerDay)
        )
        var progress = ProgressRecord()
        let didRecordFirst = progress.recordReview(first, scheduler: ReviewScheduler(clock: FixedReviewClock(start)))
        let didRecordSecond = progress.recordReview(second, scheduler: ReviewScheduler(clock: FixedReviewClock(second.reviewedAt)))
        #expect(didRecordFirst)
        #expect(didRecordSecond)
        let immutableHistory = progress.reviewEvents
        let originalAttempts = progress.attempts(for: "ble")

        let rebuilt = progress.rebuildReviewCardStates(using: ReplayScheduler(now: second.reviewedAt))
        let state = progress.cardState(topicID: "ble", questionID: "q1")

        #expect(rebuilt == 1)
        #expect(progress.reviewEvents == immutableHistory)
        #expect(progress.attempts(for: "ble") == originalAttempts)
        #expect(state?.schedulerVersion == "fsrs-ready-test-v1")
        #expect(state?.questionRevision == 1)
        #expect(state?.reviews == 2)
        #expect(state?.intervalDays == 20)
        #expect(state?.dueAt == second.reviewedAt.addingTimeInterval(20 * ReviewScheduler.secondsPerDay))
    }

    private func reviewEvent(id: UUID, rating: ReviewRating, reviewedAt: Date) -> ReviewEvent {
        ReviewEvent(
            id: id,
            topicID: "ble",
            questionID: "q1",
            choiceID: "a",
            isCorrect: true,
            rating: rating,
            conceptIDs: ["link-layer"],
            gapTags: ["layer mapping"],
            reviewedAt: reviewedAt
        )
    }
}

private struct ReplayScheduler: ReviewScheduling {
    let now: Date
    let schedulerVersion = "fsrs-ready-test-v1"

    func schedule(
        previous: ReviewCardState?,
        rating: ReviewRating,
        reviewedAt: Date?
    ) -> ReviewCardState {
        let reviewedAt = reviewedAt ?? now
        let interval = (previous?.intervalDays ?? 0) + 10
        return ReviewCardState(
            schedulerVersion: "ignored-by-progress-record",
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
