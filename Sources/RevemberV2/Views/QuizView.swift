import SwiftUI

struct QuizView: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic

    @State private var questionIndex = 0
    @State private var selectedChoiceID: String?
    @State private var lastAnswerWasCorrect: Bool?
    @State private var selectedRating: ReviewRating?

    private var question: Question? {
        guard topic.questions.indices.contains(questionIndex) else { return nil }
        return topic.questions[questionIndex]
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
                                    Text("Question \(questionIndex + 1) of \(topic.questions.count)")
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

                            VStack(spacing: 8) {
                                ForEach(Array(question.choices.enumerated()), id: \.element.id) { index, choice in
                                    ChoiceButton(
                                        index: index + 1,
                                        choice: choice,
                                        isSelected: selectedChoiceID == choice.id,
                                        isLocked: selectedChoiceID != nil
                                    ) {
                                        selectedChoiceID = choice.id
                                        selectedRating = nil
                                        lastAnswerWasCorrect = store.answer(topic: topic, question: question, choice: choice)
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
                                .disabled(questionIndex == 0)

                                Spacer()

                                Button {
                                    moveQuestion(by: 1)
                                } label: {
                                    Label(questionIndex == topic.questions.count - 1 ? "Restart" : "Next", systemImage: "chevron.right")
                                }
                                .keyboardShortcut(.space, modifiers: [])
                                .disabled(selectedChoiceID == nil)
                            }
                        }
                    }
                    .frame(maxWidth: 760)

                    CheckInInsightPanel(
                        topic: topic,
                        question: question,
                        selectedRating: $selectedRating,
                        answered: selectedChoiceID != nil
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
    }

    private func moveQuestion(by delta: Int) {
        let nextIndex = questionIndex + delta
        if topic.questions.indices.contains(nextIndex) {
            questionIndex = nextIndex
        } else {
            questionIndex = 0
        }
        selectedChoiceID = nil
        lastAnswerWasCorrect = nil
        selectedRating = nil
    }
}

private enum ReviewRating: String, CaseIterable {
    case missed = "Missed"
    case hard = "Hard"
    case good = "Good"
    case easy = "Easy"

    var tint: Color {
        switch self {
        case .missed: RevemberTheme.ruby
        case .hard: RevemberTheme.amber
        case .good: RevemberTheme.cyan
        case .easy: RevemberTheme.magenta
        }
    }

    var nextReviewText: String {
        switch self {
        case .missed: "Repeat soon"
        case .hard: "Due tomorrow"
        case .good: "Due in 2 days"
        case .easy: "Due in 4 days"
        }
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

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SurfacePanel {
                VStack(alignment: .leading, spacing: 12) {
                    SectionEyebrow(text: "Session Signal")
                    HStack {
                        MasteryRing(progress: store.progress.score(for: topic.id), tint: RevemberTheme.cyan)
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
                    SectionEyebrow(text: "Next Review")
                    Text(selectedRating?.nextReviewText ?? "Answer, then rate the effort")
                        .font(.headline)
                        .foregroundStyle(selectedRating?.tint ?? RevemberTheme.secondaryInk)

                    HStack(spacing: 8) {
                        ForEach(ReviewRating.allCases, id: \.self) { rating in
                            Button(rating.rawValue) {
                                selectedRating = rating
                            }
                            .buttonStyle(.bordered)
                            .tint(selectedRating == rating ? rating.tint : RevemberTheme.secondaryInk)
                            .disabled(answered == false)
                        }
                    }
                }
            }
        }
        .frame(width: 310)
    }
}
