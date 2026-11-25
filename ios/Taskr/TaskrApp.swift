import SwiftUI

@main
struct TaskrApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    private let wired: Bool = {
        TaskActivity.wire()
        return true
    }()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environment(\.palette, model.screenPalette)
                .tint(model.screenPalette.accent)
                .task { await model.restore() }
                .onOpenURL { model.open($0) }
                .onAppear {
                    TalkLaunch.model = model
                    TalkLaunch.consume()
                    MorningNudge.install { action, easyId in
                        if action == "talk" {
                            model.link = .talk
                        } else if action == "start", let easyId, !easyId.isEmpty {
                            model.link = .task(easyId)
                            let hex = model.accentHex
                            Task { await TaskActivity.begin(taskId: easyId, accentHex: hex) }
                        } else if let easyId, !easyId.isEmpty {
                            model.link = .task(easyId)
                        } else {
                            model.link = .today
                        }
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active, model.user != nil else { return }
                    TalkLaunch.consume()
                    Task { await wake() }
                }
                .onChange(of: model.user?.id) { _, id in
                    guard id != nil else { return }
                    TalkLaunch.consume()
                    Task { await wake() }
                }
                .onReceive(NotificationCenter.default.publisher(for: TalkLaunch.notification)) { _ in
                    TalkLaunch.consume()
                }
        }
    }

    private func wake() async {
        MorningNudge.markOpened()
        if MorningNudge.enabled { _ = await MorningNudge.requestPermission() }
        await TodayGlance.refresh(api: model.api, accentHex: model.accentHex)
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
