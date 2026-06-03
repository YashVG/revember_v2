import SwiftUI

struct TopicDetailView: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic

    var body: some View {
        VStack(spacing: 0) {
            TopicHeader(topic: topic)
                .padding([.horizontal, .top])

            TabView {
                ConceptReviewView(topic: topic)
                    .tabItem {
                        Label("Concepts", systemImage: "list.bullet.rectangle")
                    }

                QuizView(topic: topic)
                    .tabItem {
                        Label("Check-In", systemImage: "checklist")
                    }
            }
            .padding(.top, 8)
        }
    }
}

private struct TopicHeader: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(topic.title)
                        .font(.largeTitle.weight(.semibold))
                    Text(topic.summary)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(store.progressSummary(for: topic))
                        .font(.headline)
                    Text("\(topic.concepts.count) concepts, \(topic.questions.count) questions")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            let weakConcepts = store.weakConcepts(for: topic)
            if weakConcepts.isEmpty == false {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Current weak concepts")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    FlowTagList(labels: weakConcepts.map(\.title))
                }
            }
        }
    }
}
