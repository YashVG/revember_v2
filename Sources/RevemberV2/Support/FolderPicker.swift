import AppKit
import Foundation

enum FolderPicker {
    @MainActor
    static func chooseDirectory(startingAt url: URL) -> URL? {
        let panel = NSOpenPanel()
        panel.title = "Choose RevemberKnowledge Folder"
        panel.prompt = "Use Folder"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = url
        return panel.runModal() == .OK ? panel.url : nil
    }

    @MainActor
    static func reveal(_ url: URL) {
        NSWorkspace.shared.open(url)
    }
}
