import SwiftUI

struct ConceptReviewView: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                SurfacePanel {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                SectionEyebrow(text: "Concept Ladder")
                                Text("From physical states to app-level meaning")
                                    .font(.title3.weight(.semibold))
                                    .foregroundStyle(RevemberTheme.ink)
                            }
                            Spacer()
                            MasteryRing(progress: store.progress.score(for: topic.id), tint: RevemberTheme.cyan)
                        }

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(topic.concepts) { concept in
                                    ConceptNode(
                                        concept: concept,
                                        isWeak: store.weakConcepts(for: topic).contains(where: { $0.id == concept.id })
                                    )
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }

                ForEach(Array(topic.concepts.enumerated()), id: \.element.id) { index, concept in
                    ConceptCard(
                        index: index + 1,
                        concept: concept,
                        isWeak: store.weakConcepts(for: topic).contains(where: { $0.id == concept.id })
                    )
                }

                if topic.gaps.isEmpty == false {
                    Divider()
                        .padding(.vertical, 4)

                    Text("Known Gaps")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(RevemberTheme.ink)

                    ForEach(topic.gaps) { gap in
                        SurfacePanel {
                            VStack(alignment: .leading, spacing: 8) {
                                Label(gap.title, systemImage: "exclamationmark.triangle")
                                    .font(.headline)
                                    .foregroundStyle(RevemberTheme.amber)
                                Text(gap.description)
                                    .foregroundStyle(RevemberTheme.secondaryInk)
                                FlowTagList(labels: [gap.tag])
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
    }
}

private struct ConceptNode: View {
    let concept: Concept
    let isWeak: Bool

    var body: some View {
        VStack(spacing: 6) {
            Circle()
                .fill(isWeak ? RevemberTheme.amber : RevemberTheme.cyan)
                .frame(width: 9, height: 9)
            Text(concept.title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(RevemberTheme.secondaryInk)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(width: 82)
        }
    }
}

private struct ConceptCard: View {
    let index: Int
    let concept: Concept
    let isWeak: Bool

    var body: some View {
        SurfacePanel {
            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 8) {
                    Text(String(format: "%02d", index))
                        .font(.caption.monospacedDigit().weight(.bold))
                        .foregroundStyle(isWeak ? RevemberTheme.amber : RevemberTheme.cyan)
                    Rectangle()
                        .fill(isWeak ? RevemberTheme.amber.opacity(0.55) : RevemberTheme.cyan.opacity(0.5))
                        .frame(width: 1)
                }
                .frame(width: 34)

                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Label(concept.title, systemImage: isWeak ? "bolt.trianglebadge.exclamationmark" : "lightbulb")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(RevemberTheme.ink)
                        Spacer()
                        Text(isWeak ? "fragile" : "stable target")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(isWeak ? RevemberTheme.amber : RevemberTheme.cyan)
                    }

                    Text(concept.firstPrinciples)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(RevemberTheme.ink)
                    Text(concept.explanation)
                        .foregroundStyle(RevemberTheme.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(alignment: .firstTextBaseline, spacing: 14) {
                        if concept.confusableTerms.isEmpty == false {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Confusable")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(RevemberTheme.mutedInk)
                                FlowTagList(labels: concept.confusableTerms)
                            }
                        }

                        if concept.gapTags.isEmpty == false {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Gap tags")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(RevemberTheme.mutedInk)
                                FlowTagList(labels: concept.gapTags)
                            }
                        }
                    }
                }
            }
        }
    }
}
