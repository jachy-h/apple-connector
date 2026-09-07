// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "AppleConnectorHelper",
  platforms: [.macOS(.v14)],
  products: [.executable(name: "apple-connector-helper", targets: ["AppleConnectorHelper"])],
  targets: [.executableTarget(name: "AppleConnectorHelper")]
)
