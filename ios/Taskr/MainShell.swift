import SwiftUI

enum ShellTab {
    case today, all
}

struct MainShell: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    /// One list state for the top chips and the bottom tabs.
    @State private var boardView: BoardView = .today

    var body: some View {
        ZStack(alignment: .bottom) {
            NavigationStack {
                VStack(spacing: 0) {
                    if model.user?.isGuest == true {
                        Text("Guest mode — sample data, nothing permanent. Tap Talk to try voice.")
                            .font(.footnote)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(palette.accentSoft)
                    }
                    TaskBoardView(view: $boardView)
                }
                .background(palette.bg)
            }
            .safeAreaInset(edge: .bottom) {
                bottomBar
            }

            if model.talkOpen {
                if model.talkKind == .quick {
                    TalkSheet()
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else {
                    LiveTalkSheet()
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .animation(.spring(duration: 0.28), value: model.talkOpen)
        .onChange(of: model.link) { _, link in
            guard let link else { return }
            switch link {
            case .today:
                boardView = .today
            case .talk:
                model.talkOpen = true
            case .task(let id):
                boardView = .today
                model.pendingTaskId = id
            }
            model.link = nil
        }
    }

    private var bottomBar: some View {
        HStack {
            tabButton(.today, "Today", "sun.max")
            Spacer()
            Button {
                model.talkKind = .live
                model.talkOpen.toggle()
            } label: {
                VStack(spacing: 2) {
                    Image(systemName: "mic.fill")
                        .font(.title2)
                        .frame(width: 56, height: 56)
                        .background(palette.accent)
                        .foregroundStyle(.white)
                        .clipShape(Circle())
                        .shadow(color: palette.accent.opacity(0.35), radius: model.talkOpen ? 16 : 8)
                    Text("Talk").font(.caption2).foregroundStyle(palette.muted)
                }
            }
            .accessibilityLabel(model.talkOpen ? "Close conversation" : "Talk to assistant")
            Spacer()
            tabButton(.all, "All", "list.bullet")
        }
        .padding(.horizontal, 28)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(.ultraThinMaterial)
    }

    private func tabButton(_ value: ShellTab, _ title: String, _ symbol: String) -> some View {
        let selected = value == .all ? boardView == .all : boardView != .all
        return Button {
            boardView = value == .all ? .all : .today
        } label: {
            VStack(spacing: 4) {
                Image(systemName: symbol)
                Text(title).font(.caption2)
            }
            .foregroundStyle(selected ? palette.accent : palette.muted)
            .frame(width: 64)
        }
    }
}
