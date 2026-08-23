import SwiftUI

@main
@MainActor
struct MSFMenuBarApp: App {
  @StateObject private var model = MenuBarModel()

  var body: some Scene {
    MenuBarExtra {
      MenuContentView(model: model)
    } label: {
      MenuBarLabel(model: model)
    }
    .menuBarExtraStyle(.menu)

    Settings {
      ConnectionSettingsView(model: model)
    }
  }
}
