// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "RevemberV2",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "RevemberV2", targets: ["RevemberV2"]),
        .library(name: "RevemberV2Core", targets: ["RevemberV2Core"])
    ],
    targets: [
        .target(
            name: "RevemberV2Core",
            path: "Sources/RevemberV2"
        ),
        .executableTarget(
            name: "RevemberV2",
            dependencies: ["RevemberV2Core"],
            path: "Sources/RevemberV2App"
        ),
        .testTarget(
            name: "RevemberV2Tests",
            dependencies: ["RevemberV2Core"]
        )
    ]
)
