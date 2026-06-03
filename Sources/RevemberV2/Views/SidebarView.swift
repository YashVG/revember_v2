import SwiftUI

struct SidebarView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        List(selection: $store.selectedTopicID) {
            Section("Topics") {
                ForEach(store.topics) { topic in
                    TopicRow(topic: topic)
                        .tag(topic.id as String?)
                }
            }

            if let errorMessage = store.errorMessage {
                Section("Status") {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
            }
        }
        .navigationTitle("Revember")
        .listStyle(.sidebar)
    }
}

private struct TopicRow: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(topic.title, systemImage: "book.closed")
                .font(.headline)
            Text(store.progressSummary(for: topic))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
