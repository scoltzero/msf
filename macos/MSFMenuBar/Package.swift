// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MSFMenuBar",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "MSFMenuBarCore", targets: ["MSFMenuBarCore"]),
        .executable(name: "MSFMenuBar", targets: ["MSFMenuBarApp"]),
    ],
    targets: [
        .target(name: "MSFMenuBarCore"),
        .executableTarget(
            name: "MSFMenuBarApp",
            dependencies: ["MSFMenuBarCore"]
        ),
        .testTarget(
            name: "MSFMenuBarCoreTests",
            dependencies: ["MSFMenuBarCore"]
        ),
    ]
)
