import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @StateObject private var notifications = ReviewNotificationService.shared

    var body: some View {
        Form {
            Section("Knowledge Store") {
                Text(store.knowledgeRootPath)
                    .font(.callout.monospaced())
                    .textSelection(.enabled)

                HStack {
                    Button {
                        if let selected = FolderPicker.chooseDirectory(startingAt: store.knowledgeRoot) {
                            store.setKnowledgeRoot(selected)
                        }
                    } label: {
                        Label("Choose Folder", systemImage: "folder")
                    }

                    Button {
                        FolderPicker.reveal(store.knowledgeRoot)
                    } label: {
                        Label("Open Folder", systemImage: "arrow.up.forward.square")
                    }

                    Button {
                        store.resetKnowledgeRoot()
                    } label: {
                        Label("Reset", systemImage: "arrow.counterclockwise")
                    }
                }
            }

            Section("Progress") {
                Text("Progress is saved locally to \(RevemberPaths.defaultProgressURL.path).")
                    .foregroundStyle(.secondary)
            }

            Section("System Integration") {
                Toggle(
                    "Notify me when the next review is due",
                    isOn: Binding(
                        get: { notifications.isEnabled },
                        set: { enabled in
                            Task {
                                let isEnabled = await notifications.setEnabled(enabled)
                                guard isEnabled else { return }
                                await notifications.scheduleNextReview(
                                    dueAt: store.dueReviewCount > 0 ? Date() : store.nextDueAt,
                                    dueCount: store.dueReviewCount
                                )
                            }
                        }
                    )
                )

                LabeledContent("Notification access") {
                    Text(notificationStatus)
                        .foregroundStyle(.secondary)
                }

                LabeledContent("Shortcuts") {
                    Text("Start Review, Open Topic, Capture Checkpoint")
                        .foregroundStyle(.secondary)
                }

                Text("Revember topics are indexed locally for Spotlight when the knowledge store reloads.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .task {
            await notifications.refreshAuthorizationStatus()
        }
    }

    private var notificationStatus: String {
        switch notifications.authorizationStatus {
        case .authorized: "Allowed"
        case .denied: "Denied in System Settings"
        case .provisional: "Provisional"
        case .ephemeral: "Temporary"
        case .notDetermined: "Not requested"
        @unknown default: "Unknown"
        }
    }
}
