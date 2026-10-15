import SwiftUI

enum ShellTab {
    case today, all
}

struct MainShell: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @State private var tab: ShellTab = .today

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
                    Group {
                        switch tab {
                        case .today:
                            TaskBoardView(initial: .today)
                        case .all:
                            TaskBoardView(initial: .all)
                        }
                    }
                }
                .background(palette.bg)
                .navigationTitle(tab == .today ? "Today" : "All")
                .navigationBarTitleDisplayMode(.large)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink {
                            AccountView()
                        } label: {
                            Image(systemName: "person.circle")
                                .font(.title3)
                        }
                        .accessibilityLabel("Account")
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                bottomBar
            }

            if model.talkOpen {
                TalkSheet()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.28), value: model.talkOpen)
    }

    private var bottomBar: some View {
        HStack {
            tabButton(.today, "Today", "sun.max")
            Spacer()
            Button {
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
        Button {
            tab = value
        } label: {
            VStack(spacing: 4) {
                Image(systemName: symbol)
                Text(title).font(.caption2)
            }
            .foregroundStyle(tab == value ? palette.accent : palette.muted)
            .frame(width: 64)
        }
    }
}
