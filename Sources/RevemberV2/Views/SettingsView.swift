import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore

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
                Text("Progress is saved locally to ~/Library/Application Support/RevemberV2/progress.json.")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}
