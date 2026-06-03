import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ZStack {
            CockpitBackground()

            NavigationSplitView {
                SidebarView()
                    .navigationSplitViewColumnWidth(min: 260, ideal: 290, max: 340)
            } detail: {
                if let topic = store.selectedTopic {
                    TopicDetailView(topic: topic)
                } else {
                    EmptyKnowledgeView()
                }
            }
            .scrollContentBackground(.hidden)
            .background(.clear)
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
        .preferredColorScheme(.dark)
    }
}

private struct EmptyKnowledgeView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "books.vertical")
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(RevemberTheme.cyan)
            Text("No Topics")
                .font(.largeTitle.weight(.semibold))
            Text("Add JSON topic files to \(store.knowledgeRootPath)/topics, then reload.")
                .foregroundStyle(RevemberTheme.secondaryInk)
                .multilineTextAlignment(.center)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}
