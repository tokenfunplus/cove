// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "CoveLauncher",
    defaultLocalization: "en",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "CoveLauncher", targets: ["CoveLauncher"]),
        .executable(name: "CoveLauncherApp", targets: ["CoveLauncherApp"]),
    ],
    targets: [
        .target(name: "CoveLauncher"),
        .executableTarget(
            name: "CoveLauncherApp",
            dependencies: ["CoveLauncher"],
            resources: [.process("Resources")]
        ),
        .testTarget(name: "CoveLauncherTests", dependencies: ["CoveLauncher"]),
    ]
)
