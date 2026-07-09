import Foundation
import SwiftUI

@MainActor
public final class AppStore: ObservableObject {
    @Published public var topics: [KnowledgeTopic] = []
    @Published public var selectedTopicID: String?
    @Published public var progress = ProgressRecord()
    @Published public var errorMessage: String?
    @Published public var knowledgeRootPath: String

    private let knowledgeLoader: KnowledgeLoading
    private let progressStore: ProgressStoring
    private let userDefaults: UserDefaults

    public init(
        knowledgeLoader: KnowledgeLoading = KnowledgeLoader(),
        progressStore: ProgressStoring = ProgressFileStore(),
        knowledgeRoot: URL = KnowledgeLoader.defaultKnowledgeRoot,
        userDefaults: UserDefaults = .standard
    ) {
        self.knowledgeLoader = knowledgeLoader
        self.progressStore = progressStore
        self.userDefaults = userDefaults
        self.knowledgeRootPath = RevemberPaths.configuredKnowledgeRoot?.path
            ?? userDefaults.string(forKey: "knowledgeRootPath")
            ?? knowledgeRoot.path
        reload()
        loadProgress()
    }

    public var selectedTopic: KnowledgeTopic? {
        guard let selectedTopicID else { return topics.first }
        return topics.first { $0.id == selectedTopicID } ?? topics.first
    }

    public var knowledgeRoot: URL {
        URL(fileURLWithPath: knowledgeRootPath, isDirectory: true)
    }

    public func reload() {
        do {
            topics = try knowledgeLoader.loadTopics(from: knowledgeRoot)
            if selectedTopicID == nil || topics.contains(where: { $0.id == selectedTopicID }) == false {
                selectedTopicID = topics.first?.id
            }
            errorMessage = nil
        } catch {
            topics = []
            selectedTopicID = nil
            errorMessage = error.localizedDescription
        }
    }

    public func loadProgress() {
        do {
            progress = try progressStore.load()
        } catch {
            progress = ProgressRecord()
            errorMessage = "Could not load progress: \(error.localizedDescription)"
        }
    }

    public func setKnowledgeRoot(_ url: URL) {
        knowledgeRootPath = url.path
        userDefaults.set(url.path, forKey: "knowledgeRootPath")
        reload()
    }

    public func resetKnowledgeRoot() {
        setKnowledgeRoot(KnowledgeLoader.defaultKnowledgeRoot)
    }

    @discardableResult
    public func answer(topic: KnowledgeTopic, question: Question, choice: AnswerChoice) -> Bool {
        let isCorrect = progress.recordAnswer(topicID: topic.id, question: question, choice: choice)
        saveProgress()
        return isCorrect
    }

    public func progressSummary(for topic: KnowledgeTopic) -> String {
        let attempts = progress.attempts(for: topic.id)
        guard attempts > 0 else { return "No check-ins yet" }
        let score = Int((progress.score(for: topic.id) * 100).rounded())
        return "\(score)% across \(attempts) answers"
    }

    public func weakConcepts(for topic: KnowledgeTopic) -> [Concept] {
        guard let topicProgress = progress.topics[topic.id] else { return [] }
        return topicProgress.weakConceptIDs
            .sorted { $0.value > $1.value }
            .compactMap { topic.concept(withID: $0.key) }
    }

    private func saveProgress() {
        do {
            try progressStore.save(progress)
            errorMessage = nil
        } catch {
            errorMessage = "Could not save progress: \(error.localizedDescription)"
        }
    }
}
