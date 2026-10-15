import SwiftUI

@main
struct TaskrApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environment(\.palette, model.screenPalette)
                .tint(model.screenPalette.accent)
                .task { await model.restore() }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette

    var body: some View {
        ZStack {
            palette.bg.ignoresSafeArea()
            if model.booting {
                ProgressView()
            } else if model.user == nil {
                LoginView()
            } else {
                MainShell()
            }
        }
        .foregroundStyle(palette.ink)
    }
}
