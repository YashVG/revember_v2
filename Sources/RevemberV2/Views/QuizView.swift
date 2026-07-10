import SwiftUI

struct QuizView: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic

    @State private var questionIndex = 0
    @State private var selectedChoiceID: String?
    @State private var lastAnswerWasCorrect: Bool?
    @State private var selectedRating: ReviewRating?
    @State private var pendingReviewID = UUID()
    @State private var hasRevealedRecallChoices = false
    @State private var answeredQuestionVersionKey: String?
    @State private var lastCommittedSchedule: ReviewSchedulePresentation?

    private var questions: [Question] {
        topic.questions.filter { $0.retiredAt == nil }
    }

    private var question: Question? {
        guard questions.indices.contains(questionIndex) else { return nil }
        return questions[questionIndex]
    }

    private var questionVersionKey: String {
        question.map { "\($0.id)::\($0.revision)" } ?? "none"
    }

    var body: some View {
        ScrollView {
            HStack(alignment: .top, spacing: 18) {
                if let question {
                    SurfacePanel {
                        VStack(alignment: .leading, spacing: 14) {
                            HStack {
                                VStack(alignment: .leading, spacing: 5) {
                                    SectionEyebrow(text: "Focus Check-In")
                                    Text("Question \(questionIndex + 1) of \(questions.count)")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(RevemberTheme.secondaryInk)
                                }
                                Spacer()
                                FlowTagList(labels: question.gapTags)
                            }

                            Text(question.prompt)
                                .font(.system(size: 24, weight: .semibold, design: .rounded))
                                .foregroundStyle(RevemberTheme.ink)
                                .fixedSize(horizontal: false, vertical: true)

                            if question.kind.requiresRecallBeforeChoices && hasRevealedRecallChoices == false {
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
                                VStack(spacing: 8) {
                                    ForEach(Array(question.choices.enumerated()), id: \.element.id) { index, choice in
                                        ChoiceButton(
                                            index: index + 1,
                                            choice: choice,
                                            isSelected: selectedChoiceID == choice.id,
                                            isLocked: selectedChoiceID != nil
                                        ) {
                                            selectedChoiceID = choice.id
                                            selectedRating = choice.isCorrect ? nil : .missed
                                            pendingReviewID = UUID()
                                            lastAnswerWasCorrect = choice.isCorrect
                                            answeredQuestionVersionKey = questionVersionKey
                                            lastCommittedSchedule = nil
                                        }
                                    }
                                }
                            }

                            if selectedChoiceID != nil {
                                AnswerExplanationView(question: question, wasCorrect: lastAnswerWasCorrect == true)
                            }

                            HStack {
                                Button {
                                    moveQuestion(by: -1)
                                } label: {
                                    Label("Previous", systemImage: "chevron.left")
                                }
                                .disabled(questionIndex == 0 || selectedChoiceID != nil)

                                Spacer()

                                Button {
                                    commitAndMove(question: question)
                                } label: {
                                    Label(questionIndex == questions.count - 1 ? "Restart" : "Next", systemImage: "chevron.right")
                                }
                                .keyboardShortcut(.space, modifiers: [])
                                .disabled(selectedChoiceID == nil || selectedRating == nil)
                            }
                        }
                    }
                    .frame(maxWidth: 760)

                    CheckInInsightPanel(
                        topic: topic,
                        question: question,
                        selectedRating: $selectedRating,
                        answered: selectedChoiceID != nil,
                        wasCorrect: lastAnswerWasCorrect,
                        lastCommittedSchedule: lastCommittedSchedule
                    )
                } else {
                    ContentUnavailableView(
                        "No Questions",
                        systemImage: "questionmark.circle",
                        description: Text("Add preauthored questions to this topic JSON.")
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onChange(of: questionVersionKey) { _, _ in
            resetAnswerState()
        }
    }

    private func moveQuestion(by delta: Int) {
        let nextIndex = questionIndex + delta
        if questions.indices.contains(nextIndex) {
            questionIndex = nextIndex
        } else {
            questionIndex = 0
        }
        resetAnswerState()
    }

    private func resetAnswerState() {
        selectedChoiceID = nil
        lastAnswerWasCorrect = nil
        selectedRating = nil
        pendingReviewID = UUID()
        hasRevealedRecallChoices = false
        answeredQuestionVersionKey = nil
    }

    private func commitAndMove(question: Question) {
        guard answeredQuestionVersionKey == "\(question.id)::\(question.revision)",
              let selectedChoiceID,
              let choice = question.choices.first(where: { $0.id == selectedChoiceID }),
              let selectedRating,
              let result = store.commitReview(
                topic: topic,
                question: question,
                choice: choice,
                rating: selectedRating,
                eventID: pendingReviewID
              )
        else {
            return
        }
        lastCommittedSchedule = ReviewSchedulePresentation(cardState: result.cardState)
        moveQuestion(by: 1)
    }
}

private struct ChoiceButton: View {
    let index: Int
    let choice: AnswerChoice
    let isSelected: Bool
    let isLocked: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(index)")
                    .font(.callout.monospacedDigit().weight(.bold))
                    .foregroundStyle(isSelected ? RevemberTheme.background : RevemberTheme.secondaryInk)
                    .frame(width: 28, height: 28)
                    .background(choiceTint.opacity(isSelected ? 1 : 0.2), in: Circle())

                Text(choice.text)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(RevemberTheme.ink)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)

                Spacer(minLength: 6)

                if isSelected {
                    Image(systemName: choice.isCorrect ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(choiceTint)
                        .padding(.top, 4)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(isSelected ? choiceTint.opacity(0.14) : RevemberTheme.panelLift.opacity(0.78))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(isSelected ? choiceTint.opacity(0.7) : RevemberTheme.hairline, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(isLocked)
    }

    private var choiceTint: Color {
        choice.isCorrect ? RevemberTheme.cyan : RevemberTheme.ruby
    }
}

private struct AnswerExplanationView: View {
    let question: Question
    let wasCorrect: Bool

    var body: some View {
        SurfacePanel {
            VStack(alignment: .leading, spacing: 10) {
                Label(wasCorrect ? "Correct" : "Not quite", systemImage: wasCorrect ? "checkmark.circle" : "exclamationmark.circle")
                    .font(.headline)
                    .foregroundStyle(wasCorrect ? RevemberTheme.cyan : RevemberTheme.amber)
                Text(question.explanation)
                    .foregroundStyle(RevemberTheme.secondaryInk)
                if let correct = question.correctChoice {
                    Text("Correct answer: \(correct.text)")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(RevemberTheme.ink)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct CheckInInsightPanel: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic
    let question: Question
    @Binding var selectedRating: ReviewRating?
    let answered: Bool
    let wasCorrect: Bool?
    let lastCommittedSchedule: ReviewSchedulePresentation?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SurfacePanel {
                VStack(alignment: .leading, spacing: 12) {
                    SectionEyebrow(text: "Session Signal")
                    HStack {
                        MasteryRing(progress: store.currentScore(for: topic), tint: RevemberTheme.cyan)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(store.progressSummary(for: topic))
                                .font(.headline)
                                .foregroundStyle(RevemberTheme.ink)
                            Text("Progress updates only after retrieval.")
                                .font(.caption)
                                .foregroundStyle(RevemberTheme.secondaryInk)
                        }
                    }
                }
            }

            SurfacePanel {
                VStack(alignment: .leading, spacing: 12) {
                    SectionEyebrow(text: "Gap Diagnosis")
                    FlowTagList(labels: question.gapTags)
                    Text(question.conceptIDs.joined(separator: " -> "))
                        .font(.caption.monospaced())
                        .foregroundStyle(RevemberTheme.secondaryInk)
                }
            }

            SurfacePanel {
                VStack(alignment: .leading, spacing: 12) {
                    SectionEyebrow(text: lastCommittedSchedule == nil ? "Next Review" : "Last Saved Schedule")
                    if let lastCommittedSchedule {
                        Text("Saved")
                            .font(.headline)
                            .foregroundStyle(RevemberTheme.cyan)
                        Text("Previous check due \(lastCommittedSchedule.dueAt, style: .relative)")
                            .font(.callout)
                            .foregroundStyle(RevemberTheme.ink)
                        Text(lastCommittedSchedule.intervalText)
                            .font(.caption)
                            .foregroundStyle(RevemberTheme.secondaryInk)
                    } else {
                        Text(selectedRating == nil ? "Answer, then rate the effort" : "Save to schedule your next review")
                            .font(.headline)
                            .foregroundStyle(selectedRating?.tint ?? RevemberTheme.secondaryInk)
                    }

                    HStack(spacing: 8) {
                        ForEach(ReviewRating.allCases, id: \.self) { rating in
                            Button(rating.title) {
                                selectedRating = rating
                            }
                            .buttonStyle(.bordered)
                            .tint(selectedRating == rating ? rating.tint : RevemberTheme.secondaryInk)
                            .disabled(answered == false || (wasCorrect == false && rating != .missed))
                        }
                    }

                    if wasCorrect == false {
                        Text("Incorrect retrievals are recorded as Missed so they return soon.")
                            .font(.caption)
                            .foregroundStyle(RevemberTheme.amber)
                    }
                }
            }
        }
        .frame(width: 310)
    }
}
