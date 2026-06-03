import SwiftUI

struct QuizView: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic

    @State private var questionIndex = 0
    @State private var selectedChoiceID: String?
    @State private var lastAnswerWasCorrect: Bool?

    private var question: Question? {
        guard topic.questions.indices.contains(questionIndex) else { return nil }
        return topic.questions[questionIndex]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let question {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Question \(questionIndex + 1) of \(topic.questions.count)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(question.prompt)
                            .font(.title2.weight(.semibold))
                    }
                    Spacer()
                    FlowTagList(labels: question.gapTags)
                }

                VStack(spacing: 10) {
                    ForEach(question.choices) { choice in
                        Button {
                            selectedChoiceID = choice.id
                            lastAnswerWasCorrect = store.answer(topic: topic, question: question, choice: choice)
                        } label: {
                            HStack {
                                Text(choice.text)
                                    .multilineTextAlignment(.leading)
                                Spacer()
                                if selectedChoiceID == choice.id {
                                    Image(systemName: choice.isCorrect ? "checkmark.circle.fill" : "xmark.circle.fill")
                                        .foregroundStyle(choice.isCorrect ? .green : .red)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 6)
                        }
                        .buttonStyle(.bordered)
                        .disabled(selectedChoiceID != nil)
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
                }
            } else {
                ContentUnavailableView(
                    "No Questions",
                    systemImage: "questionmark.circle",
                    description: Text("Add preauthored questions to this topic JSON.")
                )
            }
        }
        .padding()
        .frame(maxWidth: 880, maxHeight: .infinity, alignment: .topLeading)
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
    }
}

private struct AnswerExplanationView: View {
    let question: Question
    let wasCorrect: Bool

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                Label(wasCorrect ? "Correct" : "Not quite", systemImage: wasCorrect ? "checkmark.circle" : "exclamationmark.circle")
                    .font(.headline)
                    .foregroundStyle(wasCorrect ? .green : .orange)
                Text(question.explanation)
                    .foregroundStyle(.secondary)
                if let correct = question.correctChoice {
                    Text("Correct answer: \(correct.text)")
                        .font(.callout.weight(.semibold))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
