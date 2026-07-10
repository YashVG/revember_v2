import Foundation

public protocol ReviewClock: Sendable {
    func now() -> Date
}

public struct SystemReviewClock: ReviewClock {
    public init() {}

    public func now() -> Date {
        Date()
    }
}

public struct FixedReviewClock: ReviewClock {
    public let date: Date

    public init(_ date: Date) {
        self.date = date
    }

    public func now() -> Date {
        date
    }
}

/// A narrow algorithm boundary so the persistence and UI layers can adopt FSRS
/// without rewriting review-event storage or queue construction.
public protocol ReviewScheduling: Sendable {
    /// Persisted with derived card state so a replacement scheduler can identify
    /// which algorithm produced the current cache.
    var schedulerVersion: String { get }
    var now: Date { get }

    func schedule(
        previous: ReviewCardState?,
        rating: ReviewRating,
        reviewedAt: Date?
    ) -> ReviewCardState
}

/// The deliberately small, transparent scheduler documented in the product research.
public struct ReviewScheduler: ReviewScheduling, Sendable {
    public static let algorithmVersion = "simple-v1"
    public static let minutesPerDay = 1_440.0
    public static let secondsPerDay = 86_400.0

    private let clock: any ReviewClock

    public init(clock: any ReviewClock = SystemReviewClock()) {
        self.clock = clock
    }

    public var now: Date {
        clock.now()
    }

    public var schedulerVersion: String {
        Self.algorithmVersion
    }

    public func schedule(
        previous: ReviewCardState?,
        rating: ReviewRating,
        reviewedAt: Date? = nil
    ) -> ReviewCardState {
        let reviewedAt = reviewedAt ?? clock.now()
        let interval = intervalDays(previous: previous, rating: rating)
        let previousDifficulty = previous?.difficulty ?? 5
        let difficulty = min(10, max(1, previousDifficulty + difficultyDelta(for: rating)))

        return ReviewCardState(
            schedulerVersion: Self.algorithmVersion,
            dueAt: reviewedAt.addingTimeInterval(interval * Self.secondsPerDay),
            intervalDays: interval,
            stability: interval,
            difficulty: difficulty,
            lastRating: rating,
            lapses: (previous?.lapses ?? 0) + (rating == .missed ? 1 : 0),
            reviews: (previous?.reviews ?? 0) + 1,
            lastReviewedAt: reviewedAt
        )
    }

    public func intervalDays(previous: ReviewCardState?, rating: ReviewRating) -> Double {
        guard let previous else {
            switch rating {
            case .missed:
                return 15 / Self.minutesPerDay
            case .hard:
                return 1
            case .good:
                return 2
            case .easy:
                return 4
            }
        }

        switch rating {
        case .missed:
            return 1
        case .hard:
            return max(1, previous.intervalDays * 1.2)
        case .good:
            return previous.intervalDays * 2.2
        case .easy:
            return previous.intervalDays * 3
        }
    }

    private func difficultyDelta(for rating: ReviewRating) -> Double {
        switch rating {
        case .missed: 1
        case .hard: 0.25
        case .good: -0.25
        case .easy: -1
        }
    }
}

/// Presentation-only details from the schedule state that was actually persisted.
/// Keeping this beside the scheduler lets all review surfaces use one truthful label.
struct ReviewSchedulePresentation: Equatable {
    let dueAt: Date
    let intervalDays: Double

    init(cardState: ReviewCardState) {
        dueAt = cardState.dueAt
        intervalDays = cardState.intervalDays
    }

    var intervalText: String {
        if intervalDays < 1 {
            let minutes = max(1, Int((intervalDays * ReviewScheduler.minutesPerDay).rounded()))
            return "\(minutes) min interval"
        }

        let roundedDays = intervalDays.rounded()
        let number = abs(intervalDays - roundedDays) < 0.000_001
            ? roundedDays.formatted(.number.precision(.fractionLength(0)))
            : intervalDays.formatted(.number.precision(.fractionLength(1)))
        return "\(number) \(abs(intervalDays - 1) < 0.000_001 ? "day" : "days") interval"
    }
}
