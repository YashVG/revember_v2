import SwiftUI

struct SidebarView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ZStack {
            RevemberTheme.backgroundLift.opacity(0.88)

            VStack(alignment: .leading, spacing: 18) {
                RevemberLogoLockup()
                .padding(.top, 14)

                SurfacePanel {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionEyebrow(text: "Today")
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(store.dueReviewCount) due checks")
                                    .font(.headline)
                                    .foregroundStyle(RevemberTheme.ink)
                                Text("Current-revision evidence only")
                                    .font(.caption)
                                    .foregroundStyle(RevemberTheme.secondaryInk)
                            }
                            Spacer()
                            MasteryRing(
                                progress: store.selectedTopic.map { store.currentScore(for: $0) } ?? 0,
                                tint: RevemberTheme.cyan
                            )
                            .frame(width: 46, height: 46)
                        }
                    }
                }

                SectionEyebrow(text: "Topics")

                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(store.topics) { topic in
                            Button {
                                store.selectedTopicID = topic.id
                            } label: {
                                TopicRow(topic: topic, isSelected: store.selectedTopicID == topic.id)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                if let errorMessage = store.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(RevemberTheme.amber)
                        .padding(.bottom, 10)
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

private struct TopicRow: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 4)
                .fill(isSelected ? RevemberTheme.cyan : RevemberTheme.amber)
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 6) {
                Text(topic.title)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(RevemberTheme.ink)
                Text(store.progressSummary(for: topic))
                    .font(.caption)
                    .foregroundStyle(RevemberTheme.secondaryInk)
                FlowTagList(labels: ["\(topic.concepts.count) concepts", "\(topic.questions.count) checks"])
            }

            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(isSelected ? RevemberTheme.panelLift : RevemberTheme.panel.opacity(0.76))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(isSelected ? RevemberTheme.cyan.opacity(0.42) : RevemberTheme.hairline, lineWidth: 1)
                )
        )
    }
}
