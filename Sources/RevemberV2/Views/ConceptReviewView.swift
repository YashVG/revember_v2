import SwiftUI

struct ConceptReviewView: View {
    let topic: KnowledgeTopic

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                ForEach(topic.concepts) { concept in
                    GroupBox {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(concept.firstPrinciples)
                                .font(.callout.weight(.medium))
                            Text(concept.explanation)
                                .foregroundStyle(.secondary)

                            if concept.confusableTerms.isEmpty == false {
                                LabeledContent("Confusable") {
                                    FlowTagList(labels: concept.confusableTerms)
                                }
                            }

                            if concept.gapTags.isEmpty == false {
                                LabeledContent("Gap tags") {
                                    FlowTagList(labels: concept.gapTags)
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    } label: {
                        Label(concept.title, systemImage: "lightbulb")
                            .font(.title3.weight(.semibold))
                    }
                }

                if topic.gaps.isEmpty == false {
                    Divider()
                        .padding(.vertical, 4)

                    Text("Known Gaps")
                        .font(.title2.weight(.semibold))

                    ForEach(topic.gaps) { gap in
                        GroupBox {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(gap.description)
                                FlowTagList(labels: [gap.tag])
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        } label: {
                            Text(gap.title)
                        }
                    }
                }
            }
            .padding()
        }
    }
}
