import SwiftUI

struct TodayReviewView: View {
    @EnvironmentObject private var store: AppStore

    let session: ReviewSession
    let onFinish: () -> Void

    @State private var itemIndex = 0
    @State private var selectedChoiceID: String?
    @State private var selectedRating: ReviewRating?
    @State private var pendingReviewID = UUID()
    @State private var completedCount = 0
    @State private var saveError: String?
    @State private var hasRevealedRecallChoices = false
    @State private var committedSchedules: [ReviewSchedulePresentation] = []

    private var currentItem: DueReviewItem? {
        guard session.items.indices.contains(itemIndex) else { return nil }
        return session.items[itemIndex]
    }

    var body: some View {
        ZStack {
            CockpitBackground()

            if let item = currentItem {
                review(item)
            } else {
                completion
            }
        }
        .preferredColorScheme(.dark)
    }

    private func review(_ item: DueReviewItem) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    Button(action: onFinish) {
                        Label("Exit Review", systemImage: "xmark")
                    }
                    .buttonStyle(.bordered)

                    Spacer()

                    Label("\(itemIndex + 1) of \(session.items.count)", systemImage: "timer")
                        .font(.callout.monospacedDigit().weight(.semibold))
                        .foregroundStyle(RevemberTheme.secondaryInk)
                }

                SurfacePanel {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 5) {
                                SectionEyebrow(
                                    text: item.isRevised ? "Revised Check" : (item.isNew ? "New Check" : "Due Check")
                                )
                                Text(item.topic.title)
                                    .font(.callout.weight(.semibold))
                                    .foregroundStyle(RevemberTheme.cyan)
                            }
                            Spacer()
                            Text(item.question.transferLevel.rawValue.capitalized)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(RevemberTheme.secondaryInk)
                        }

                        Text(item.question.prompt)
                            .font(.system(size: 28, weight: .semibold, design: .rounded))
                            .foregroundStyle(RevemberTheme.ink)
                            .fixedSize(horizontal: false, vertical: true)

                        if item.question.kind.requiresRecallBeforeChoices && hasRevealedRecallChoices == false {
                            VStack(alignment: .leading, spacing: 10) {
                                Label("Recall before cues", systemImage: "text.bubble")
                                    .font(.headline)
                                    .foregroundStyle(RevemberTheme.cyan)
                                Text("Answer mentally or aloud, then reveal the choices to score what you recalled.")
                                    .font(.callout)
                                    .foregroundStyle(RevemberTheme.secondaryInk)
                                Button("Reveal Choices") {
                                    hasRevealedRecallChoices = true
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(RevemberTheme.cyan)
                            }
                            .padding(14)
                            .background(RevemberTheme.panelLift.opacity(0.72), in: RoundedRectangle(cornerRadius: 12))
                        } else {
                            VStack(spacing: 9) {
                                ForEach(Array(item.question.choices.enumerated()), id: \.element.id) { index, choice in
                                    Button {
                                        guard selectedChoiceID == nil else { return }
                                        selectedChoiceID = choice.id
                                        selectedRating = choice.isCorrect ? nil : .missed
                                        saveError = nil
                                    } label: {
                                        TodayReviewChoiceRow(
                                            number: index + 1,
                                            choice: choice,
                                            isSelected: selectedChoiceID == choice.id,
                                            isAnswered: selectedChoiceID != nil
                                        )
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(selectedChoiceID != nil)
                                }
                            }
                        }

                        if selectedChoiceID != nil {
                            Divider().overlay(RevemberTheme.hairline)

                            VStack(alignment: .leading, spacing: 10) {
                                Text(item.question.explanation)
                                    .font(.callout)
                                    .foregroundStyle(RevemberTheme.secondaryInk)

                                Text("How hard was retrieval?")
                                    .font(.headline)
                                    .foregroundStyle(RevemberTheme.ink)

                                HStack(spacing: 8) {
                                    ForEach(ReviewRating.allCases, id: \.self) { rating in
                                        Button(rating.title) {
                                            selectedRating = rating
                                        }
                                        .buttonStyle(.borderedProminent)
                                        .tint(selectedRating == rating ? rating.tint : RevemberTheme.panelLift)
                                        .disabled(selectedChoiceIsIncorrect && rating != .missed)
                                    }
                                }

                                if selectedChoiceIsIncorrect {
                                    Text("Incorrect retrievals are recorded as Missed so they return soon.")
                                        .font(.caption)
                                        .foregroundStyle(RevemberTheme.amber)
                                }
                            }
                        }

                        if let saveError {
                            Label(saveError, systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundStyle(RevemberTheme.ruby)
                        }

                        HStack {
                            Text("The answer and rating are saved together.")
                                .font(.caption)
                                .foregroundStyle(RevemberTheme.mutedInk)
                            Spacer()
                            Button {
                                commitAndAdvance(item)
                            } label: {
                                Label(
                                    itemIndex == session.items.count - 1 ? "Finish Review" : "Save & Continue",
                                    systemImage: "arrow.right"
                                )
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(RevemberTheme.cyan)
                            .disabled(selectedChoiceID == nil || selectedRating == nil)
                            .keyboardShortcut(.return, modifiers: [])
                        }
                    }
                }
            }
            .frame(maxWidth: 840)
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .top)
        }
    }

    private var completion: some View {
        SurfacePanel {
            VStack(spacing: 16) {
                Image(systemName: session.items.isEmpty ? "checkmark.seal" : "brain.head.profile.fill")
                    .font(.system(size: 46, weight: .semibold))
                    .foregroundStyle(RevemberTheme.cyan)
                Text(session.items.isEmpty ? "Nothing is due" : "Review complete")
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(RevemberTheme.ink)
                Text(
                    session.items.isEmpty
                        ? "New and scheduled checks will appear here when they are ready."
                        : "You saved \(completedCount) retrieval \(completedCount == 1 ? "event" : "events") to your local learner record."
                )
                .foregroundStyle(RevemberTheme.secondaryInk)
                .multilineTextAlignment(.center)
                if let nextSchedule = committedSchedules.min(by: { $0.dueAt < $1.dueAt }) {
                    VStack(spacing: 4) {
                        Text("Earliest next review from this session")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(RevemberTheme.mutedInk)
                        Text(nextSchedule.dueAt, style: .relative)
                            .font(.headline)
                            .foregroundStyle(RevemberTheme.cyan)
                        Text(nextSchedule.intervalText)
                            .font(.caption)
                            .foregroundStyle(RevemberTheme.secondaryInk)
                    }
                }
                Button("Return to Topic", action: onFinish)
                    .buttonStyle(.borderedProminent)
                    .tint(RevemberTheme.cyan)
            }
            .frame(width: 430)
        }
    }

    private func commitAndAdvance(_ item: DueReviewItem) {
        guard let selectedChoiceID,
              let choice = item.question.choices.first(where: { $0.id == selectedChoiceID }),
              let selectedRating
        else { return }

        guard let result = store.commitReview(
            item: item,
            choice: choice,
            rating: selectedRating,
            eventID: pendingReviewID
        ) else {
            saveError = store.errorMessage ?? "The review could not be saved."
            return
        }

        committedSchedules.append(ReviewSchedulePresentation(cardState: result.cardState))
        completedCount += 1
        itemIndex += 1
        self.selectedChoiceID = nil
        self.selectedRating = nil
        pendingReviewID = UUID()
        saveError = nil
        hasRevealedRecallChoices = false
    }

    private var selectedChoiceIsIncorrect: Bool {
        guard let item = currentItem,
              let selectedChoiceID,
              let choice = item.question.choices.first(where: { $0.id == selectedChoiceID })
        else { return false }
        return choice.isCorrect == false
    }

}

private struct TodayReviewChoiceRow: View {
    let number: Int
    let choice: AnswerChoice
    let isSelected: Bool
    let isAnswered: Bool

    private var answerTint: Color {
        choice.isCorrect ? RevemberTheme.cyan : RevemberTheme.ruby
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(String(number))
                .font(.callout.monospacedDigit().weight(.bold))
                .frame(width: 28, height: 28)
                .foregroundStyle(isSelected ? RevemberTheme.background : RevemberTheme.secondaryInk)
                .background(isSelected ? answerTint : RevemberTheme.panelLift, in: Circle())

            VStack(alignment: .leading, spacing: 5) {
                Text(choice.text)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(RevemberTheme.ink)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)

                if isSelected, let rationale = choice.rationale, rationale.isEmpty == false {
                    Text(rationale)
                        .font(.caption)
                        .foregroundStyle(RevemberTheme.secondaryInk)
                        .multilineTextAlignment(.leading)
                }
            }

            Spacer(minLength: 0)

            if isSelected {
                Image(systemName: choice.isCorrect ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .foregroundStyle(answerTint)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(isSelected ? answerTint.opacity(0.14) : RevemberTheme.panelLift.opacity(0.78))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(isSelected ? answerTint.opacity(0.7) : RevemberTheme.hairline, lineWidth: 1)
                )
        )
        .opacity(isAnswered && isSelected == false ? 0.66 : 1)
    }
}
