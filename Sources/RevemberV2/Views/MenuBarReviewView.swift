import AppKit
import SwiftUI

struct MenuBarReviewView: View {
    @Environment(\.openWindow) private var openWindow
    @EnvironmentObject private var store: AppStore
    @ObservedObject private var router = AppIntentRouter.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Revember")
                    .font(.headline)
                Text(reviewSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Button {
                startReview(minutes: 3)
            } label: {
                Label("Start 3-Minute Review", systemImage: "brain.head.profile")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.borderedProminent)

            if let nextDueAt = store.nextDueAt, store.dueReviewCount == 0 {
                Text("Next scheduled \(nextDueAt, style: .relative)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Divider()

            Button {
                openWindow(id: "main")
                NSApp.activate(ignoringOtherApps: true)
            } label: {
                Label("Open Revember", systemImage: "macwindow")
            }

            Button("Quit Revember") {
                NSApp.terminate(nil)
            }
        }
        .padding(14)
        .frame(width: 260)
    }

    private var reviewSummary: String {
        switch store.dueReviewCount {
        case 0: "No checks are due right now"
        case 1: "1 check is ready"
        default: "\(store.dueReviewCount) checks are ready"
        }
    }

    private func startReview(minutes: Int) {
        router.enqueue(.startTodayReview(minutes: minutes))
        openWindow(id: "main")
        NSApp.activate(ignoringOtherApps: true)
    }
}
