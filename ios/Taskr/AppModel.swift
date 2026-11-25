import Foundation
import SwiftUI
import UIKit

@MainActor
final class AppModel: ObservableObject {
    let api = APIClient()
    @Published var user: UserAccount?
    @Published var booting = true
    @Published var paletteChoice: PaletteChoice {
        didSet { UserDefaults.standard.set(paletteChoice.rawValue, forKey: "taskr.palette") }
    }
    @Published var talkOpen = false {
        didSet {
            if oldValue && !talkOpen { boardRevision += 1 }
        }
    }
    /// Bumps when Talk closes so Today/All reload what the assistant just did.
    @Published var boardRevision = 0
    @Published var talkKind: TalkKind = .live
    /// "" is All. A session filter, not remembered, so the board opens on All.
    @Published var bucketSpot = ""
    /// Weekend switch. Hides the bucket named Work. Remembered.
    @Published var hideWork: Bool {
        didSet { UserDefaults.standard.set(hideWork, forKey: "taskr.hideWork") }
    }
    /// Leaves completed tasks out of the list. Remembered.
    @Published var hideFinished: Bool {
        didSet { UserDefaults.standard.set(hideFinished, forKey: "taskr.hideFinished") }
    }
    /// Easy-win session length. 15, 30, or 45.
    @Published var winMinutes: Int {
        didSet { UserDefaults.standard.set(winMinutes, forKey: "taskr.winMinutes") }
    }
    /// Which list opens. Today or Everything.
    @Published var homeView: BoardView {
        didSet { UserDefaults.standard.set(homeView.rawValue, forKey: "taskr.home") }
    }
    /// Hex from the current bucket. Nil on All.
    @Published var bucketTintHex: String?
    /// Set by a widget tap or the morning note. The shell consumes it.
    @Published var link: AppLink?
    @Published var pendingTaskId: String?

    var palette: Palette { Palette.resolve(paletteChoice) }
    var screenPalette: Palette {
        guard let hex = bucketTintHex, !bucketSpot.isEmpty else { return palette }
        return palette.tinted(with: hex)
    }

    init() {
        let raw = UserDefaults.standard.string(forKey: "taskr.palette") ?? "auto"
        paletteChoice = PaletteChoice(rawValue: raw) ?? .auto
        hideWork = UserDefaults.standard.bool(forKey: "taskr.hideWork")
        hideFinished = UserDefaults.standard.bool(forKey: "taskr.hideFinished")
        let storedMinutes = UserDefaults.standard.object(forKey: "taskr.winMinutes") as? Int
        winMinutes = storedMinutes == 15 || storedMinutes == 45 ? storedMinutes! : 30
        homeView = UserDefaults.standard.string(forKey: "taskr.home") == "today" ? .today : .all
    }

    func restore() async {
        defer { booting = false }
        do {
            user = try await api.get("auth/me")
        } catch {
            user = nil
        }
    }

    func login(email: String, password: String) async throws {
        user = try await api.post("auth/login", body: ["email": email, "password": password])
    }

    func register(email: String, password: String, displayName: String) async throws {
        let zone = TimeZone.current.identifier
        user = try await api.post("auth/register", body: [
            "email": email,
            "password": password,
            "displayName": displayName,
            "timezone": zone,
        ])
    }

    func guest() async throws {
        user = try await api.post("auth/guest", body: ["timezone": TimeZone.current.identifier])
    }

    func logout() async {
        try? await api.discard("auth/logout")
        HTTPCookieStorage.shared.cookies?.forEach { HTTPCookieStorage.shared.deleteCookie($0) }
        SessionShare.clear()
        user = nil
        talkOpen = false
    }

    func open(_ url: URL) {
        guard url.scheme == "taskr" else { return }
        switch url.host {
        case "talk":
            link = .talk
        case "task":
            let id = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            link = id.isEmpty ? .today : .task(id)
        default:
            link = .today
        }
    }

    var accentHex: String {
        let palette = screenPalette.accent
        let ui = UIColor(palette)
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: nil)
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
    }
}

enum TalkKind {
    case live, quick
}

enum AppLink: Equatable {
    case today
    case talk
    case task(String)
}
