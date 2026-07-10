import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}

public struct RevemberV2App: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var store = AppStore()
    @ObservedObject private var intentRouter = AppIntentRouter.shared

    public init() {}

    public var body: some Scene {
        WindowGroup("Revember", id: "main") {
            ContentView()
                .environmentObject(store)
                .frame(minWidth: 980, minHeight: 640)
        }
        .windowStyle(.titleBar)

        Settings {
            SettingsView()
                .environmentObject(store)
                .frame(width: 580)
                .padding()
        }

        MenuBarExtra {
            MenuBarReviewView()
                .environmentObject(store)
        } label: {
            Label("Revember", systemImage: store.dueReviewCount > 0 ? "brain.head.profile.fill" : "brain.head.profile")
        }
        .menuBarExtraStyle(.window)
        .commands {
            CommandMenu("Review") {
                Button("Start 3-Minute Review") {
                    intentRouter.enqueue(.startTodayReview(minutes: 3))
                    NSApp.activate(ignoringOtherApps: true)
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])
            }
        }
    }
}
