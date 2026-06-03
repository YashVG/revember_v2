import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        NavigationSplitView {
            SidebarView()
        } detail: {
            if let topic = store.selectedTopic {
                TopicDetailView(topic: topic)
            } else {
                ContentUnavailableView(
                    "No Topics",
                    systemImage: "books.vertical",
                    description: Text("Add JSON topic files to \(store.knowledgeRootPath)/topics, then reload.")
                )
            }
        }
        .toolbar {
            ToolbarItemGroup {
                Button {
                    store.reload()
                } label: {
                    Label("Reload Topics", systemImage: "arrow.clockwise")
                }
                SettingsLink {
                    Label("Settings", systemImage: "gearshape")
                }
            }
        }
    }
}
