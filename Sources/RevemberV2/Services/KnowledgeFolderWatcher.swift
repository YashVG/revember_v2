import Darwin
import Dispatch
import Foundation

public protocol KnowledgeWatching: AnyObject, Sendable {
    func start(watching knowledgeRoot: URL, onChange: @escaping @Sendable () -> Void) throws
    func stop()
}

public enum KnowledgeWatcherError: LocalizedError {
    case cannotWatch(URL, Int32)

    public var errorDescription: String? {
        switch self {
        case let .cannotWatch(url, errorCode):
            "Could not watch \(url.path) for changes (errno \(errorCode))."
        }
    }
}

/// Watches both the knowledge root and its topics directory, coalescing editor save bursts
/// into one callback. AppStore performs the actual reload on the main actor.
public final class KnowledgeFolderWatcher: KnowledgeWatching, @unchecked Sendable {
    private let queue: DispatchQueue
    private let debounceInterval: TimeInterval
    private let lock = NSLock()

    private var sources: [DispatchSourceFileSystemObject] = []
    private var debounceWorkItem: DispatchWorkItem?
    private var onChange: (@Sendable () -> Void)?

    public init(
        debounceInterval: TimeInterval = 0.25,
        queue: DispatchQueue = DispatchQueue(label: "app.revember.knowledge-watcher", qos: .utility)
    ) {
        self.debounceInterval = debounceInterval
        self.queue = queue
    }

    deinit {
        stop()
    }

    public func start(watching knowledgeRoot: URL, onChange: @escaping @Sendable () -> Void) throws {
        stop()

        let root = knowledgeRoot.standardizedFileURL
        let topics = root.appendingPathComponent("topics", isDirectory: true)
        let fileManager = FileManager.default
        var directories = [root]
        if fileManager.fileExists(atPath: topics.path) {
            directories.append(topics)
        }

        var newSources: [DispatchSourceFileSystemObject] = []
        do {
            for directory in directories {
                newSources.append(try makeSource(for: directory))
            }
        } catch {
            newSources.forEach { $0.cancel() }
            throw error
        }

        lock.lock()
        self.onChange = onChange
        sources = newSources
        lock.unlock()

        newSources.forEach { $0.resume() }
    }

    public func stop() {
        lock.lock()
        let oldSources = sources
        sources = []
        debounceWorkItem?.cancel()
        debounceWorkItem = nil
        onChange = nil
        lock.unlock()

        oldSources.forEach { $0.cancel() }
    }

    private func makeSource(for directory: URL) throws -> DispatchSourceFileSystemObject {
        let descriptor = open(directory.path, O_EVTONLY)
        guard descriptor >= 0 else {
            throw KnowledgeWatcherError.cannotWatch(directory, errno)
        }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor,
            eventMask: [.write, .delete, .rename, .extend, .attrib, .link],
            queue: queue
        )
        source.setEventHandler { [weak self] in
            self?.scheduleDebouncedCallback()
        }
        source.setCancelHandler {
            close(descriptor)
        }
        return source
    }

    private func scheduleDebouncedCallback() {
        lock.lock()
        debounceWorkItem?.cancel()
        let callback = onChange
        let workItem = DispatchWorkItem {
            callback?()
        }
        debounceWorkItem = workItem
        lock.unlock()

        queue.asyncAfter(deadline: .now() + debounceInterval, execute: workItem)
    }
}
