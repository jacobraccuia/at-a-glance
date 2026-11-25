import SwiftUI
import UIKit

struct MainShell: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    /// One list state for the top chips and the bottom tabs.
    @State private var boardView: BoardView = .today
    /// Keyboard height from the bottom of the screen. Zero when it is hidden.
    @State private var keyboardOverlap: CGFloat = 0

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
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(palette.bg)
            }
            .ignoresSafeArea(edges: .bottom)

            bottomChrome
                .padding(.bottom, keyboardOverlap > 0 ? keyboardOverlap + 8 : min(homeInset, 16))
                .ignoresSafeArea(edges: .bottom)

            if model.talkOpen {
                LiveTalkSheet()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
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
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
            let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect ?? .zero
            let overlap = max(0, UIScreen.main.bounds.maxY - frame.minY)
            let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
            withAnimation(.easeOut(duration: duration)) {
                keyboardOverlap = overlap
            }
        }
    }

    /// Add field sits on the circles. While typing, the circles drop away and the field rides the keyboard.
    private var bottomChrome: some View {
        VStack(spacing: 8) {
            if model.bucketSpot != "__archive" {
                CaptureBar()
                    .padding(.horizontal, 16)
            }
            if keyboardOverlap == 0 {
                bottomBar
            }
        }
    }

    private var talkButton: some View {
        Button {
            model.talkKind = .live
            model.talkOpen.toggle()
        } label: {
            Image(systemName: "mic.fill")
                .font(.system(size: 32, weight: .semibold))
                .frame(width: 72, height: 72)
                .background(model.talkOpen ? palette.danger : palette.accent)
                .foregroundStyle(.white)
                .clipShape(Circle())
                .shadow(color: (model.talkOpen ? palette.danger : palette.accent).opacity(0.28), radius: 8, y: 3)
        }
        .accessibilityLabel(model.talkOpen ? "Close conversation" : "Talk")
    }

    /// Today and All float. The mic is its own circle between them.
    private var bottomBar: some View {
        HStack(alignment: .center) {
            statusIcon(.today, "sun.max")
            Spacer(minLength: 12)
            talkButton
            Spacer(minLength: 12)
            statusIcon(.all, "list.bullet")
        }
        .padding(.horizontal, 36)
    }

    private func statusIcon(_ option: BoardView, _ symbol: String) -> some View {
        let on = boardView == option
        return Button {
            boardView = option
        } label: {
            Image(systemName: symbol)
                .font(.title3.weight(.semibold))
                .foregroundStyle(on ? palette.accent : palette.ink)
                .frame(width: 56, height: 56)
                .modifier(GlassChip())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
    }

    /// Distance from the glass to the home-indicator safe line.
    private var homeInset: CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .safeAreaInsets.bottom ?? 0
    }
}

private struct CaptureBar: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @State private var draft = ""
    @State private var note: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                TextField("Add a task...", text: $draft)
                    .submitLabel(.done)
                    .onSubmit { Task { await captureNow() } }
                Button {
                    Task { await captureNow() }
                } label: {
                    Image(systemName: "arrow.right")
                        .frame(width: 36, height: 36)
                        .background(palette.accent)
                        .foregroundStyle(.white)
                        .clipShape(Circle())
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Add")
            }
            .padding(8)
            .background(palette.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(palette.border))
            if let note {
                Text(note).font(.caption).foregroundStyle(palette.muted)
            }
        }
    }

    private func captureNow() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        struct Body: Encodable { let text: String; let addToToday: Bool }
        struct Captured: Decodable { let horizon: String? }
        do {
            let created: [Captured] = try await model.api.post("tasks/quick-capture", body: Body(text: text, addToToday: true))
            note = savedNote(created.map { $0.horizon ?? "later" })
            NotificationCenter.default.post(name: .taskrTasksChanged, object: nil)
        } catch {
            draft = text
        }
    }

    private func savedNote(_ horizons: [String]) -> String {
        let labels = [
            "today": "Today", "tomorrow": "Tomorrow", "nextWeek": "Upcoming", "later": "Later",
        ]
        let places = Array(Set(horizons.map { labels[$0] ?? "Later" }))
        if horizons.count == 1 { return "Saved to \(places[0])." }
        if places.count == 1 { return "Saved \(horizons.count) to \(places[0])." }
        return "Saved \(horizons.count). Each one landed in its own time."
    }
}

private struct GlassChip: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: Capsule())
        } else {
            content.background(.ultraThinMaterial, in: Capsule())
        }
    }
}
