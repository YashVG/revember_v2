import SwiftUI

struct RevemberLogoMark: View {
    let size: CGFloat

    init(size: CGFloat = 42) {
        self.size = size
    }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let primaryStroke = max(4, side * 0.14)
            let secondaryStroke = max(2, side * 0.065)

            ZStack {
                Path { path in
                    path.move(to: CGPoint(x: side * 0.13, y: side * 0.26))
                    path.addLine(to: CGPoint(x: side * 0.39, y: side * 0.68))
                }
                .stroke(
                    RevemberTheme.cyan,
                    style: StrokeStyle(lineWidth: primaryStroke, lineCap: .round, lineJoin: .round)
                )

                Path { path in
                    path.move(to: CGPoint(x: side * 0.39, y: side * 0.68))
                    path.addLine(to: CGPoint(x: side * 0.85, y: side * 0.18))
                }
                .stroke(
                    RevemberTheme.magenta,
                    style: StrokeStyle(lineWidth: primaryStroke, lineCap: .round, lineJoin: .round)
                )

                Path { path in
                    path.move(to: CGPoint(x: side * 0.22, y: side * 0.82))
                    path.addLine(to: CGPoint(x: side * 0.82, y: side * 0.82))
                }
                .stroke(
                    RevemberTheme.amber,
                    style: StrokeStyle(lineWidth: secondaryStroke, lineCap: .round)
                )

                Path { path in
                    path.move(to: CGPoint(x: side * 0.36, y: side * 0.96))
                    path.addLine(to: CGPoint(x: side * 0.68, y: side * 0.96))
                }
                .stroke(
                    RevemberTheme.secondaryInk.opacity(0.42),
                    style: StrokeStyle(lineWidth: max(1.5, side * 0.045), lineCap: .round)
                )
            }
            .frame(width: side, height: side)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct RevemberLogoLockup: View {
    var subtitle: String = "Fundamentals cockpit"

    var body: some View {
        HStack(spacing: 12) {
            RevemberLogoMark()

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 0) {
                    Text("Re")
                        .foregroundStyle(RevemberTheme.ink)
                    Text("v")
                        .foregroundStyle(RevemberTheme.cyan)
                    Text("ember")
                        .foregroundStyle(RevemberTheme.ink)
                }
                .font(.system(size: 31, weight: .semibold, design: .default))
                Text(subtitle)
                    .font(.callout)
                    .foregroundStyle(RevemberTheme.secondaryInk)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
