// swift-tools-version: 5.9
// Native iPhone room placement (ARKit + RealityKit). See README.md in this folder and Architecture.md
// (2026-11-16, "Native iPhone room scanning") for why this exists beside the web app.
import PackageDescription

let package = Package(
    name: "RoomPlacement",
    // macOS is listed only so `swift test` can run the pure geometry tests on a Mac; ARPlacement is iOS-only.
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "PlacementCore", targets: ["PlacementCore"]),
        .library(name: "ARPlacement", targets: ["ARPlacement"]),
    ],
    targets: [
        // Pure geometry and the project-document reader. No Apple framework types.
        .target(name: "PlacementCore"),
        // The ARKit adapter and the SwiftUI screen. Everything Apple-specific stays in here.
        .target(name: "ARPlacement", dependencies: ["PlacementCore"]),
        .testTarget(name: "PlacementCoreTests", dependencies: ["PlacementCore"]),
    ]
)
