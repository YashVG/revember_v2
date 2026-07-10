import SwiftUI

struct ConceptReviewView: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic

    private var evidenceGraph: KnowledgeGraph {
        KnowledgeGraph(topic: topic, progress: store.progress)
    }

    private var stableCoverage: Double {
        guard topic.concepts.isEmpty == false else { return 0 }
        let stableCount = topic.concepts.filter {
            evidenceGraph.evidence(forConceptID: $0.id) == .stable
        }.count
        return Double(stableCount) / Double(topic.concepts.count)
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                SurfacePanel {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                SectionEyebrow(text: "Concept Evidence")
                                Text("Authored knowledge, measured by retrieval")
                                    .font(.title3.weight(.semibold))
                                    .foregroundStyle(RevemberTheme.ink)
                            }
                            Spacer()
                            MasteryRing(progress: stableCoverage, tint: RevemberTheme.cyan)
                        }

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(topic.concepts) { concept in
                                    ConceptNode(
                                        concept: concept,
                                        evidenceStatus: evidenceGraph.evidence(forConceptID: concept.id)
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
                        evidenceStatus: evidenceGraph.evidence(forConceptID: concept.id),
                        evidenceSummary: evidenceGraph.evidenceSummary(forConceptID: concept.id)
                    )
                }

                if topic.gaps.isEmpty == false {
                    Divider()
                        .padding(.vertical, 4)

                    Text("Known Gaps")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(RevemberTheme.ink)

                    ForEach(topic.gaps) { gap in
                        let gapNode = evidenceGraph.node(withID: KnowledgeGraphNode.gapID(gap.id))
                        SurfacePanel {
                            VStack(alignment: .leading, spacing: 8) {
                                Label(gap.title, systemImage: "exclamationmark.triangle")
                                    .font(.headline)
                                    .foregroundStyle(RevemberTheme.amber)
                                Text(gap.description)
                                    .foregroundStyle(RevemberTheme.secondaryInk)
                                EvidenceLabel(
                                    status: gapNode?.evidenceStatus ?? .untested,
                                    summary: gapNode?.evidenceSummary ?? "No linked review evidence"
                                )
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
    let evidenceStatus: KnowledgeGraphNode.EvidenceStatus

    var body: some View {
        VStack(spacing: 6) {
            Circle()
                .fill(evidenceStatus.tint)
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
    let evidenceStatus: KnowledgeGraphNode.EvidenceStatus
    let evidenceSummary: String

    var body: some View {
        SurfacePanel {
            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 8) {
                    Text(String(format: "%02d", index))
                        .font(.caption.monospacedDigit().weight(.bold))
                        .foregroundStyle(evidenceStatus.tint)
                    Rectangle()
                        .fill(evidenceStatus.tint.opacity(0.55))
                        .frame(width: 1)
                }
                .frame(width: 34)

                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Label(concept.title, systemImage: evidenceStatus.systemImage)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(RevemberTheme.ink)
                        Spacer()
                        Text(evidenceStatus.title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(evidenceStatus.tint)
                    }

                    EvidenceLabel(status: evidenceStatus, summary: evidenceSummary)

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

private struct EvidenceLabel: View {
    let status: KnowledgeGraphNode.EvidenceStatus
    let summary: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Circle()
                .fill(status.tint)
                .frame(width: 7, height: 7)
            Text(summary)
                .font(.caption)
                .foregroundStyle(RevemberTheme.mutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(status.title). \(summary)")
    }
}

private extension KnowledgeGraphNode.EvidenceStatus {
    var tint: Color {
        switch self {
        case .untested: RevemberTheme.mutedInk
        case .fragile: RevemberTheme.amber
        case .developing: RevemberTheme.magenta
        case .stable: RevemberTheme.cyan
        }
    }

    var systemImage: String {
        switch self {
        case .untested: "questionmark.circle"
        case .fragile: "bolt.trianglebadge.exclamationmark"
        case .developing: "chart.line.uptrend.xyaxis"
        case .stable: "checkmark.seal"
        }
    }
}
