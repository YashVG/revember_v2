import SwiftUI

enum RevemberTheme {
    static let background = Color(red: 0.035, green: 0.037, blue: 0.043)
    static let backgroundLift = Color(red: 0.055, green: 0.058, blue: 0.068)
    static let panel = Color(red: 0.078, green: 0.082, blue: 0.096)
    static let panelLift = Color(red: 0.105, green: 0.109, blue: 0.128)
    static let hairline = Color.white.opacity(0.095)
    static let cyan = Color(red: 0.34, green: 0.82, blue: 0.86)
    static let amber = Color(red: 0.92, green: 0.67, blue: 0.32)
    static let ruby = Color(red: 0.95, green: 0.28, blue: 0.39)
    static let magenta = Color(red: 0.86, green: 0.28, blue: 0.58)
    static let ink = Color.white.opacity(0.92)
    static let secondaryInk = Color.white.opacity(0.62)
    static let mutedInk = Color.white.opacity(0.42)
}

extension ReviewRating {
    var tint: Color {
        switch self {
        case .missed: RevemberTheme.ruby
        case .hard: RevemberTheme.amber
        case .good: RevemberTheme.cyan
        case .easy: RevemberTheme.magenta
        }
    }
}

struct CockpitBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    RevemberTheme.background,
                    Color(red: 0.024, green: 0.026, blue: 0.032)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            VStack(spacing: 18) {
                ForEach(0..<10, id: \.self) { _ in
                    Rectangle()
                        .fill(RevemberTheme.hairline)
                        .frame(height: 1)
                }
            }
            .opacity(0.26)
            .padding(.horizontal, 40)
        }
        .ignoresSafeArea()
    }
}

struct SurfacePanel<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(RevemberTheme.panel.opacity(0.94))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(RevemberTheme.hairline, lineWidth: 1)
                    )
            )
    }
}

struct MetricTile: View {
    let title: String
    let value: String
    let caption: String
    let tint: Color
    let systemImage: String

    var body: some View {
        SurfacePanel {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle()
                        .fill(tint.opacity(0.16))
                    Image(systemName: systemImage)
                        .foregroundStyle(tint)
                }
                .frame(width: 34, height: 34)

                VStack(alignment: .leading, spacing: 4) {
                    Text(title.uppercased())
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(RevemberTheme.mutedInk)
                    Text(value)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(RevemberTheme.ink)
                    Text(caption)
                        .font(.caption)
                        .foregroundStyle(RevemberTheme.secondaryInk)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }
        }
    }
}

struct MasteryRing: View {
    let progress: Double
    let tint: Color

    var body: some View {
        ZStack {
            Circle()
                .stroke(RevemberTheme.hairline, lineWidth: 8)
            Circle()
                .trim(from: 0, to: max(0.04, min(progress, 1)))
                .stroke(tint, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(Int((progress * 100).rounded()))%")
                .font(.caption.weight(.bold))
                .foregroundStyle(RevemberTheme.ink)
        }
        .frame(width: 58, height: 58)
    }
}

struct SectionEyebrow: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.caption2.weight(.semibold))
            .foregroundStyle(RevemberTheme.mutedInk)
            .tracking(1.2)
    }
}
