import Dispatch
import Foundation
import Testing
@testable import RevemberV2Core

@Suite("Knowledge folder watcher", .serialized)
struct KnowledgeFolderWatcherTests {
    @Test("topic file save bursts produce one debounced callback")
    func debouncesSaveBurst() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let topics = root.appendingPathComponent("topics", isDirectory: true)
        try FileManager.default.createDirectory(at: topics, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let watcher = KnowledgeFolderWatcher(debounceInterval: 0.1)
        let callback = DispatchSemaphore(value: 0)
        let counter = LockedCounter()
        try watcher.start(watching: root) {
            counter.increment()
            callback.signal()
        }
        defer { watcher.stop() }

        let file = topics.appendingPathComponent("ble.json")
        try Data("{\"version\":1}".utf8).write(to: file, options: .atomic)
        try Data("{\"version\":2}".utf8).write(to: file, options: .atomic)
        try Data("{\"version\":3}".utf8).write(to: file, options: .atomic)

        #expect(callback.wait(timeout: .now() + 3) == .success)
        Thread.sleep(forTimeInterval: 0.3)
        #expect(counter.value == 1)
    }

    @Test("a missing topics directory is still detected when created")
    func watchesRootForTopicsCreation() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let watcher = KnowledgeFolderWatcher(debounceInterval: 0.05)
        let callback = DispatchSemaphore(value: 0)
        try watcher.start(watching: root) {
            callback.signal()
        }
        defer { watcher.stop() }

        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("topics", isDirectory: true),
            withIntermediateDirectories: true
        )

        #expect(callback.wait(timeout: .now() + 3) == .success)
    }
}

private final class LockedCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    var value: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    func increment() {
        lock.lock()
        count += 1
        lock.unlock()
    }
}
