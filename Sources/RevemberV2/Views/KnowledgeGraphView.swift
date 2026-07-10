import SwiftUI

struct KnowledgeGraphView: View {
    @EnvironmentObject private var store: AppStore
    let topic: KnowledgeTopic

    @State private var visibleLayers = Set(KnowledgeGraphNode.Layer.allCases)
    @State private var selectedNodeID: KnowledgeGraphNode.ID?
    @State private var zoom: CGFloat = 1
    @State private var pan: CGSize = .zero

    private var fullGraph: KnowledgeGraph {
        KnowledgeGraph(topic: topic, progress: store.progress)
    }

    private var graph: KnowledgeGraph {
        fullGraph.filtered(including: visibleLayers)
    }

    var body: some View {
        VStack(spacing: 14) {
            KnowledgeGraphToolbar(
                graph: graph,
                visibleLayers: visibleLayers,
                zoom: zoom,
                toggleLayer: toggleLayer,
                zoomIn: { zoom = min(1.6, zoom + 0.15) },
                zoomOut: { zoom = max(0.72, zoom - 0.15) },
                resetView: resetView
            )
            .padding(.horizontal, 24)

            HStack(alignment: .top, spacing: 14) {
                SurfacePanel {
                    KnowledgeGraphCanvas(
                        graph: graph,
                        selectedNodeID: selectedNodeID,
                        zoom: zoom,
                        pan: $pan,
                        selectNode: { selectedNodeID = $0 }
                    )
                    .frame(minHeight: 480)
                }

                KnowledgeGraphInspector(
                    topic: topic,
                    graph: graph,
                    progress: store.progress,
                    selectedNode: graph.node(withID: selectedNodeID)
                )
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .onChange(of: visibleLayers) { _, _ in
            if graph.node(withID: selectedNodeID) == nil {
                selectedNodeID = nil
            }
        }
    }

    private func toggleLayer(_ layer: KnowledgeGraphNode.Layer) {
        if visibleLayers.contains(layer) {
            guard visibleLayers.count > 1 else { return }
            visibleLayers.remove(layer)
        } else {
            visibleLayers.insert(layer)
        }
    }

    private func resetView() {
        zoom = 1
        pan = .zero
    }
}

private struct KnowledgeGraphToolbar: View {
    let graph: KnowledgeGraph
    let visibleLayers: Set<KnowledgeGraphNode.Layer>
    let zoom: CGFloat
    let toggleLayer: (KnowledgeGraphNode.Layer) -> Void
    let zoomIn: () -> Void
    let zoomOut: () -> Void
    let resetView: () -> Void

    var body: some View {
        SurfacePanel {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    SectionEyebrow(text: "Knowledge Graph")
                    HStack(spacing: 10) {
                        Label("\(graph.nodes.count) nodes", systemImage: "circle.grid.cross")
                        Label("\(graph.links.count) links", systemImage: "point.3.connected.trianglepath.dotted")
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(RevemberTheme.secondaryInk)
                }

                Spacer()

                HStack(spacing: 8) {
                    ForEach(KnowledgeGraphNode.Layer.allCases, id: \.self) { layer in
                        Button {
                            toggleLayer(layer)
                        } label: {
                            Label(layer.title, systemImage: layer.systemImage)
                        }
                        .buttonStyle(.bordered)
                        .tint(visibleLayers.contains(layer) ? layer.tint : RevemberTheme.secondaryInk)
                    }
                }

                Divider()
                    .frame(height: 24)

                HStack(spacing: 6) {
                    Button(action: zoomOut) {
                        Label("Zoom Out", systemImage: "minus.magnifyingglass")
                    }
                    .help("Zoom Out")

                    Button(action: resetView) {
                        Label("\(Int((zoom * 100).rounded()))%", systemImage: "scope")
                    }
                    .help("Reset View")

                    Button(action: zoomIn) {
                        Label("Zoom In", systemImage: "plus.magnifyingglass")
                    }
                    .help("Zoom In")
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.bordered)
            }
        }
    }
}

private struct KnowledgeGraphCanvas: View {
    let graph: KnowledgeGraph
    let selectedNodeID: KnowledgeGraphNode.ID?
    let zoom: CGFloat
    @Binding var pan: CGSize
    let selectNode: (KnowledgeGraphNode.ID) -> Void

    @State private var panAtDragStart: CGSize?

    var body: some View {
        GeometryReader { proxy in
            let positions = KnowledgeGraphLayout.positions(for: graph, in: proxy.size)

            ZStack {
                Canvas { context, size in
                    drawGrid(in: &context, size: size)

                    for link in graph.links {
                        guard
                            let source = positions[link.sourceID],
                            let target = positions[link.targetID]
                        else { continue }

                        let start = transformed(source, in: size)
                        let end = transformed(target, in: size)
                        let isSelected = link.sourceID == selectedNodeID || link.targetID == selectedNodeID
                        var path = Path()
                        path.move(to: start)
                        path.addLine(to: end)

                        let linkColor = link.kind.tint.opacity(isSelected ? 0.68 : 0.28)
                        context.stroke(
                            path,
                            with: .color(linkColor),
                            style: StrokeStyle(
                                lineWidth: isSelected ? 2 : 1,
                                lineCap: .round,
                                dash: link.kind.isAuthoredKnowledgeRelationship ? [] : [4, 6]
                            )
                        )

                        if link.kind.isDirectionalAuthoredRelationship {
                            drawArrowhead(
                                in: &context,
                                from: start,
                                to: end,
                                color: linkColor,
                                lineWidth: isSelected ? 2 : 1
                            )
                        }
                    }
                }

                ForEach(graph.nodes) { node in
                    if let point = positions[node.id] {
                        KnowledgeGraphNodeButton(
                            node: node,
                            isSelected: selectedNodeID == node.id,
                            action: { selectNode(node.id) }
                        )
                        .position(transformed(point, in: proxy.size))
                    }
                }

                if graph.nodes.isEmpty {
                    ContentUnavailableView(
                        "No Graph Nodes",
                        systemImage: "point.3.connected.trianglepath.dotted",
                        description: Text("Add concepts, gaps, or checks to this topic JSON.")
                    )
                    .foregroundStyle(RevemberTheme.secondaryInk)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
            .contentShape(Rectangle())
            .gesture(
                DragGesture()
                    .onChanged { value in
                        let base = panAtDragStart ?? pan
                        if panAtDragStart == nil {
                            panAtDragStart = pan
                        }
                        pan = CGSize(
                            width: base.width + value.translation.width,
                            height: base.height + value.translation.height
                        )
                    }
                    .onEnded { _ in
                        panAtDragStart = nil
                    }
            )
        }
    }

    private func transformed(_ point: CGPoint, in size: CGSize) -> CGPoint {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        return CGPoint(
            x: center.x + (point.x - center.x) * zoom + pan.width,
            y: center.y + (point.y - center.y) * zoom + pan.height
        )
    }

    private func drawGrid(in context: inout GraphicsContext, size: CGSize) {
        let spacing: CGFloat = 42
        var path = Path()
        var x: CGFloat = 0
        while x <= size.width {
            path.move(to: CGPoint(x: x, y: 0))
            path.addLine(to: CGPoint(x: x, y: size.height))
            x += spacing
        }

        var y: CGFloat = 0
        while y <= size.height {
            path.move(to: CGPoint(x: 0, y: y))
            path.addLine(to: CGPoint(x: size.width, y: y))
            y += spacing
        }

        context.stroke(path, with: .color(RevemberTheme.hairline.opacity(0.28)), lineWidth: 1)
    }

    private func drawArrowhead(
        in context: inout GraphicsContext,
        from start: CGPoint,
        to end: CGPoint,
        color: Color,
        lineWidth: CGFloat
    ) {
        let angle = atan2(end.y - start.y, end.x - start.x)
        let arrowLength: CGFloat = 9
        let targetInset: CGFloat = 16
        let spread: CGFloat = .pi / 7
        let tip = CGPoint(
            x: end.x - targetInset * cos(angle),
            y: end.y - targetInset * sin(angle)
        )
        var arrow = Path()
        arrow.move(to: tip)
        arrow.addLine(
            to: CGPoint(
                x: tip.x - arrowLength * cos(angle - spread),
                y: tip.y - arrowLength * sin(angle - spread)
            )
        )
        arrow.move(to: tip)
        arrow.addLine(
            to: CGPoint(
                x: tip.x - arrowLength * cos(angle + spread),
                y: tip.y - arrowLength * sin(angle + spread)
            )
        )
        context.stroke(arrow, with: .color(color), lineWidth: lineWidth)
    }
}

private struct KnowledgeGraphNodeButton: View {
    let node: KnowledgeGraphNode
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                ZStack {
                    Circle()
                        .fill(node.kind.tint.opacity(isSelected ? 0.98 : 0.82))
                        .shadow(color: node.kind.tint.opacity(isSelected ? 0.48 : 0.18), radius: isSelected ? 14 : 6)
                    Circle()
                        .stroke(isSelected ? RevemberTheme.ink : RevemberTheme.hairline, lineWidth: isSelected ? 2 : 1)
                    Image(systemName: node.kind.systemImage)
                        .font(.system(size: node.kind == .reviewEvent ? 10 : (node.kind == .question ? 12 : 14), weight: .bold))
                        .foregroundStyle(RevemberTheme.background)
                }
                .frame(width: nodeDiameter, height: nodeDiameter)

                Text(displayTitle)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(isSelected ? RevemberTheme.ink : RevemberTheme.secondaryInk)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.74)
                    .frame(width: 110, height: 28, alignment: .top)

                if node.reviewCount > 0 {
                    Text(node.evidenceStatus.title)
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(node.evidenceStatus.tint)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var nodeDiameter: CGFloat {
        switch node.kind {
        case .concept: CGFloat(min(44, max(32, 28 + node.weight)))
        case .gap: CGFloat(min(38, max(30, 28 + node.weight)))
        case .question: 28
        case .reviewCard: 25
        case .reviewEvent: 18
        }
    }

    private var displayTitle: String {
        if node.kind == .question || node.kind == .reviewCard, node.title.count > 42 {
            return String(node.title.prefix(39)) + "..."
        }
        return node.title
    }
}

private struct KnowledgeGraphInspector: View {
    let topic: KnowledgeTopic
    let graph: KnowledgeGraph
    let progress: ProgressRecord
    let selectedNode: KnowledgeGraphNode?

    var body: some View {
        SurfacePanel {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let selectedNode {
                        selectedNodeDetail(selectedNode)
                    } else {
                        graphOverview
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .frame(width: 300)
            .frame(maxHeight: 620)
        }
    }

    private var graphOverview: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionEyebrow(text: "Selection")
            Text(topic.title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(RevemberTheme.ink)
            Text(topic.summary)
                .foregroundStyle(RevemberTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)

            Divider()

            GraphStatRow(title: "Knowledge", value: count(.knowledge), tint: KnowledgeGraphNode.Layer.knowledge.tint)
            GraphStatRow(title: "Assessment", value: count(.assessment), tint: KnowledgeGraphNode.Layer.assessment.tint)
            GraphStatRow(title: "Learner", value: count(.learner), tint: KnowledgeGraphNode.Layer.learner.tint)

            Text("Review-event nodes preserve history. Scheduler nodes appear only for evidence matching the current check revision.")
                .font(.caption)
                .foregroundStyle(RevemberTheme.mutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func selectedNodeDetail(_ node: KnowledgeGraphNode) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("\(node.layer.title) · \(node.kind.title)", systemImage: node.kind.systemImage)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(node.kind.tint)
                Spacer()
                Text(node.rawKnowledgeID)
                    .font(.caption2.monospaced())
                    .foregroundStyle(RevemberTheme.mutedInk)
            }

            Text(node.title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(RevemberTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 6) {
                Circle()
                    .fill(node.evidenceStatus.tint)
                    .frame(width: 7, height: 7)
                Text(node.evidenceStatus.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(node.evidenceStatus.tint)
            }

            Text(node.evidenceSummary)
                .font(.caption)
                .foregroundStyle(RevemberTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)

            switch node.kind {
            case .concept:
                conceptDetail(for: node)
            case .gap:
                gapDetail(for: node)
            case .question:
                questionDetail(for: node)
            case .reviewCard, .reviewEvent:
                learnerDetail(for: node)
            }
        }
    }

    @ViewBuilder
    private func conceptDetail(for node: KnowledgeGraphNode) -> some View {
        if let concept = topic.concept(withID: node.rawKnowledgeID) {
            Text(concept.firstPrinciples)
                .font(.callout.weight(.semibold))
                .foregroundStyle(RevemberTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text(concept.explanation)
                .foregroundStyle(RevemberTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)

            if concept.confusableTerms.isEmpty == false {
                DetailTagBlock(title: "Confusable", labels: concept.confusableTerms)
            }

            if concept.gapTags.isEmpty == false {
                DetailTagBlock(title: "Gap Tags", labels: concept.gapTags)
            }

            if concept.sourceRefs.isEmpty == false {
                DetailTagBlock(title: "Sources", labels: sourceTitles(for: concept.sourceRefs))
            }

            let relationships = topic.relationships.filter {
                $0.sourceConceptID == concept.id || $0.targetConceptID == concept.id
            }
            if relationships.isEmpty == false {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Authored Relationships")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(RevemberTheme.mutedInk)
                    ForEach(relationships) { relationship in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(relationshipLabel(relationship, relativeTo: concept.id))
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(RevemberTheme.ink)
                            Text(relationship.rationale)
                                .font(.caption)
                                .foregroundStyle(RevemberTheme.secondaryInk)
                                .fixedSize(horizontal: false, vertical: true)
                            if relationship.sourceRefs.isEmpty == false {
                                Text("Sources: \(sourceTitles(for: relationship.sourceRefs).joined(separator: ", "))")
                                    .font(.caption2)
                                    .foregroundStyle(RevemberTheme.mutedInk)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func gapDetail(for node: KnowledgeGraphNode) -> some View {
        if let gap = topic.gaps.first(where: { $0.id == node.rawKnowledgeID }) {
            Text(gap.description)
                .foregroundStyle(RevemberTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)

            DetailTagBlock(title: "Tag", labels: [gap.tag])
            DetailTagBlock(
                title: "Concepts",
                labels: gap.conceptIDs.compactMap { topic.concept(withID: $0)?.title }
            )

            if gap.misconceptionIDs.isEmpty == false {
                DetailTagBlock(title: "Diagnoses", labels: gap.misconceptionIDs)
            }

            if gap.sourceRefs.isEmpty == false {
                DetailTagBlock(title: "Sources", labels: sourceTitles(for: gap.sourceRefs))
            }
        }
    }

    @ViewBuilder
    private func questionDetail(for node: KnowledgeGraphNode) -> some View {
        if let question = topic.questions.first(where: { $0.id == node.rawKnowledgeID }) {
            DetailTagBlock(
                title: "Probe",
                labels: [question.kind.title, question.transferLevel.title, "Revision \(question.revision)"]
            )

            Text(question.explanation)
                .foregroundStyle(RevemberTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)

            if let correct = question.correctChoice {
                Label(correct.text, systemImage: "checkmark.circle")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(RevemberTheme.cyan)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("Choice Diagnosis")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(RevemberTheme.mutedInk)
                ForEach(question.choices) { choice in
                    VStack(alignment: .leading, spacing: 2) {
                        Label(
                            choice.text,
                            systemImage: choice.isCorrect ? "checkmark.circle" : "xmark.circle"
                        )
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(choice.isCorrect ? RevemberTheme.cyan : RevemberTheme.secondaryInk)
                        if let rationale = choice.rationale {
                            Text(rationale)
                                .font(.caption2)
                                .foregroundStyle(RevemberTheme.secondaryInk)
                        }
                        if let misconceptionID = choice.misconceptionID {
                            Text("Misconception: \(misconceptionID)")
                                .font(.caption2.monospaced())
                                .foregroundStyle(RevemberTheme.amber)
                        }
                    }
                }
            }

            DetailTagBlock(
                title: "Concepts",
                labels: question.conceptIDs.compactMap { topic.concept(withID: $0)?.title }
            )

            if question.gapTags.isEmpty == false {
                DetailTagBlock(title: "Gap Tags", labels: question.gapTags)
            }

            if question.sourceRefs.isEmpty == false {
                DetailTagBlock(title: "Sources", labels: sourceTitles(for: question.sourceRefs))
            }
        }
    }

    private func learnerDetail(for node: KnowledgeGraphNode) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(node.subtitle)
                .font(.callout.weight(.semibold))
                .foregroundStyle(RevemberTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(node.kind == .reviewEvent
                ? "This node is an append-only retrieval fact. It is evidence, not a manually assigned mastery label."
                : "This node is the current scheduler state derived from the review event ledger.")
                .foregroundStyle(RevemberTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)

            if node.kind == .reviewEvent,
               let eventID = UUID(uuidString: node.rawKnowledgeID),
               let event = progress.reviewEvents.first(where: { $0.id == eventID }) {
                if let prompt = event.questionPrompt {
                    Text(prompt)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(RevemberTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let selectedChoiceText = event.selectedChoiceText {
                    LabeledContent("Selected") {
                        Text(selectedChoiceText)
                            .multilineTextAlignment(.trailing)
                    }
                    .font(.caption)
                }
                if event.isCorrect == false, let correctChoiceText = event.correctChoiceText {
                    LabeledContent("Correct") {
                        Text(correctChoiceText)
                            .multilineTextAlignment(.trailing)
                    }
                    .font(.caption)
                }
                if event.misconceptionIDs.isEmpty == false {
                    DetailTagBlock(title: "Diagnosed", labels: event.misconceptionIDs)
                }
                if event.sourceRefs.isEmpty == false {
                    DetailTagBlock(title: "Sources at Review", labels: sourceTitles(for: event.sourceRefs))
                }
            }
        }
    }

    private func relationshipLabel(_ relationship: KnowledgeRelationship, relativeTo conceptID: String) -> String {
        let isSource = relationship.sourceConceptID == conceptID
        let otherID = isSource ? relationship.targetConceptID : relationship.sourceConceptID
        let otherTitle = topic.concept(withID: otherID)?.title ?? otherID
        switch (relationship.kind, isSource) {
        case (.prerequisite, true): return "Prerequisite for → \(otherTitle)"
        case (.prerequisite, false): return "Requires ← \(otherTitle)"
        case (.partOf, true): return "Part of → \(otherTitle)"
        case (.partOf, false): return "Contains ← \(otherTitle)"
        case (.enables, true): return "Enables → \(otherTitle)"
        case (.enables, false): return "Enabled by ← \(otherTitle)"
        case (.contrastsWith, _): return "Contrasts with ↔ \(otherTitle)"
        }
    }

    private func sourceTitles(for refs: [String]) -> [String] {
        refs.map { ref in topic.sources.first(where: { $0.id == ref })?.title ?? ref }
    }

    private func count(_ layer: KnowledgeGraphNode.Layer) -> String {
        "\(graph.nodes.filter { $0.layer == layer }.count)"
    }
}

private struct GraphStatRow: View {
    let title: String
    let value: String
    let tint: Color

    var body: some View {
        HStack {
            Circle()
                .fill(tint)
                .frame(width: 8, height: 8)
            Text(title)
                .foregroundStyle(RevemberTheme.secondaryInk)
            Spacer()
            Text(value)
                .font(.callout.monospacedDigit().weight(.semibold))
                .foregroundStyle(RevemberTheme.ink)
        }
        .font(.callout)
    }
}

private struct DetailTagBlock: View {
    let title: String
    let labels: [String]

    var body: some View {
        if labels.isEmpty == false {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(RevemberTheme.mutedInk)
                FlowTagList(labels: labels)
            }
        }
    }
}

private extension KnowledgeGraphNode.Kind {
    var tint: Color {
        switch self {
        case .concept: RevemberTheme.cyan
        case .gap: RevemberTheme.amber
        case .question: RevemberTheme.magenta
        case .reviewCard: RevemberTheme.ruby
        case .reviewEvent: RevemberTheme.ink
        }
    }

    var systemImage: String {
        switch self {
        case .concept: "lightbulb"
        case .gap: "exclamationmark.triangle"
        case .question: "checklist"
        case .reviewCard: "calendar.badge.clock"
        case .reviewEvent: "clock.arrow.circlepath"
        }
    }
}

private extension KnowledgeGraphNode.Layer {
    var tint: Color {
        switch self {
        case .knowledge: RevemberTheme.cyan
        case .assessment: RevemberTheme.magenta
        case .learner: RevemberTheme.ruby
        }
    }

    var systemImage: String {
        switch self {
        case .knowledge: "point.3.connected.trianglepath.dotted"
        case .assessment: "checklist"
        case .learner: "person.crop.circle.badge.checkmark"
        }
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
}

private extension KnowledgeGraphLink.Kind {
    var tint: Color {
        switch self {
        case .prerequisite, .partOf, .contrastsWith, .enables: RevemberTheme.cyan
        case .gapConcept: RevemberTheme.amber
        case .questionConcept: RevemberTheme.magenta
        case .cardQuestion, .eventCard, .eventConcept: RevemberTheme.ruby
        }
    }

    var isDirectionalAuthoredRelationship: Bool {
        switch self {
        case .prerequisite, .partOf, .enables: true
        case .contrastsWith, .gapConcept, .questionConcept, .cardQuestion, .eventCard, .eventConcept: false
        }
    }
}

private extension KnowledgeRelationshipKind {
    var title: String {
        switch self {
        case .prerequisite: "Prerequisite"
        case .partOf: "Part of"
        case .contrastsWith: "Contrasts with"
        case .enables: "Enables"
        }
    }
}
