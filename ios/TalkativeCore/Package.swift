// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "TalkativeCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "TalkativeCore", targets: ["TalkativeCore"]),
    ],
    targets: [
        .target(name: "TalkativeCore"),
        .testTarget(
            name: "TalkativeCoreTests",
            dependencies: ["TalkativeCore"],
            resources: [.copy("Fixtures")]
        ),
    ],
    swiftLanguageModes: [.v5]
)
