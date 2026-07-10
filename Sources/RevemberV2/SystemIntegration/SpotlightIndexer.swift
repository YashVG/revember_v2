@preconcurrency import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

public enum SpotlightIndexer {
    private static let domainIdentifier = "com.yashvg.Revember.topics"

    public static func index(topics: [KnowledgeTopic]) {
        let items = topics.map { topic in
            let attributes = CSSearchableItemAttributeSet(contentType: .item)
            attributes.title = topic.title
            attributes.contentDescription = topic.summary
            attributes.keywords = topic.concepts.map(\.title) + topic.gaps.map(\.title)
            attributes.contentURL = URL(string: "revember://topic/\(topic.id)")
            return CSSearchableItem(
                uniqueIdentifier: "topic:\(topic.id)",
                domainIdentifier: domainIdentifier,
                attributeSet: attributes
            )
        }

        let index = CSSearchableIndex.default()
        index.deleteSearchableItems(withDomainIdentifiers: [domainIdentifier]) { _ in
            index.indexSearchableItems(items)
        }
    }
}
