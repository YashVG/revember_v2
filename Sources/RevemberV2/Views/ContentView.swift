import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: AppStore
    @ObservedObject private var intentRouter = AppIntentRouter.shared
    @StateObject private var notifications = ReviewNotificationService.shared
    @State private var activeReviewSession: ReviewSession?

    var body: some View {
        ZStack {
            CockpitBackground()

            if let activeReviewSession {
                TodayReviewView(session: activeReviewSession) {
                    self.activeReviewSession = nil
                }
            } else {
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
                            startReview(minutes: 3)
                        } label: {
                            Label("Start Review", systemImage: "brain.head.profile")
                        }

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
        .preferredColorScheme(.dark)
        .onOpenURL { url in
            intentRouter.enqueue(url: url)
        }
        .onChange(of: intentRouter.pendingAction) { _, action in
            if let action {
                handle(action)
            }
        }
        .onChange(of: store.topics) { _, topics in
            SpotlightIndexer.index(topics: topics)
        }
        .onChange(of: store.progress) { _, _ in
            scheduleNextNotification()
        }
        .task {
            SpotlightIndexer.index(topics: store.topics)
            await notifications.refreshAuthorizationStatus()
            scheduleNextNotification()
            if let action = intentRouter.pendingAction {
                handle(action)
            }
        }
    }

    private func handle(_ action: AppIntentAction) {
        switch action {
        case let .startTodayReview(minutes):
            startReview(minutes: minutes)
        case let .openTopic(id):
            activeReviewSession = nil
            if store.topics.contains(where: { $0.id == id }) {
                store.selectedTopicID = id
            } else {
                store.errorMessage = "The requested topic is not in the current knowledge store."
            }
        }
        intentRouter.consume(action)
    }

    private func startReview(minutes: Int) {
        activeReviewSession = store.makeReviewSession(duration: TimeInterval(max(1, minutes) * 60))
    }

    private func scheduleNextNotification() {
        let dueAt = store.dueReviewCount > 0 ? Date() : store.nextDueAt
        Task {
            await notifications.scheduleNextReview(
                dueAt: dueAt,
                dueCount: store.dueReviewCount
            )
        }
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
