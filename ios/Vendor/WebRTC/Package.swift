// swift-tools-version: 5.9
import PackageDescription

// Same binary as stasel/WebRTC 158.0.0.
// Zip checksum: dd26ba28fb9c8dbc82f4be3085e8d112a4e2a4e654e1786a9977a748c24c4912
let package = Package(
    name: "WebRTC",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "WebRTC", targets: ["WebRTC"]),
    ],
    targets: [
        .binaryTarget(name: "WebRTC", path: "WebRTC.xcframework"),
    ]
)
