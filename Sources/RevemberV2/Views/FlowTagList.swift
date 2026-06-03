import SwiftUI

struct FlowTagList: View {
    let labels: [String]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(labels, id: \.self) { label in
                Text(label)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(RevemberTheme.secondaryInk)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(RevemberTheme.panelLift, in: Capsule())
                    .overlay(
                        Capsule()
                            .stroke(RevemberTheme.hairline, lineWidth: 1)
                    )
            }
        }
    }
}
