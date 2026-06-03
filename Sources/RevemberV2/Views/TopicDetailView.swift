import SwiftUI

struct TopicDetailView: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic
    @State private var mode: TopicMode = .concepts

    var body: some View {
        VStack(spacing: 18) {
            TopicHeader(topic: topic, mode: $mode)
                .padding(.horizontal, 24)
                .padding(.top, 18)

            if mode == .concepts {
                HStack(spacing: 14) {
                    MetricTile(
                        title: "Due now",
                        value: "\(topic.questions.count)",
                        caption: "ready checks",
                        tint: RevemberTheme.amber,
                        systemImage: "clock"
                    )
                    MetricTile(
                        title: "Mastery",
                        value: "\(Int((store.progress.score(for: topic.id) * 100).rounded()))%",
                        caption: store.progressSummary(for: topic),
                        tint: RevemberTheme.cyan,
                        systemImage: "waveform.path.ecg"
                    )
                    MetricTile(
                        title: "Fragile links",
                        value: "\(max(store.weakConcepts(for: topic).count, topic.gaps.count))",
                        caption: "gap-aware checks",
                        tint: RevemberTheme.magenta,
                        systemImage: "point.3.connected.trianglepath.dotted"
                    )
                }
                .padding(.horizontal, 24)
            }

            switch mode {
            case .concepts:
                ConceptReviewView(topic: topic)
            case .checkIn:
                QuizView(topic: topic)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(.clear)
    }
}

private enum TopicMode: String, CaseIterable {
    case concepts = "Concept Map"
    case checkIn = "Check-In"
}

private struct TopicHeader: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic
    @Binding var mode: TopicMode

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    SectionEyebrow(text: "Retrieval Cockpit")
                    Text(topic.title)
                        .font(.largeTitle.weight(.semibold))
                        .foregroundStyle(RevemberTheme.ink)
                    Text(topic.summary)
                        .foregroundStyle(RevemberTheme.secondaryInk)
                }

                Spacer()

                Picker("Mode", selection: $mode) {
                    ForEach(TopicMode.allCases, id: \.self) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 250)

                Button {
                    mode = .checkIn
                } label: {
                    Label("Start", systemImage: "play.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(RevemberTheme.cyan)
            }

            HStack(spacing: 10) {
                Label("Local JSON", systemImage: "folder")
                Label("\(topic.concepts.count) concepts", systemImage: "lightbulb")
                Label("\(topic.questions.count) checks", systemImage: "checklist")
                Label("No cloud, no NLP", systemImage: "lock")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(RevemberTheme.secondaryInk)

            let weakConcepts = store.weakConcepts(for: topic)
            if weakConcepts.isEmpty == false {
                HStack(alignment: .firstTextBaseline) {
                    Text("Weak now")
                        .font(.caption)
                        .foregroundStyle(RevemberTheme.amber)
                    FlowTagList(labels: weakConcepts.map(\.title))
                }
            }
        }
    }
}
