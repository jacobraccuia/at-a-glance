import Foundation
import SwiftUI

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

    var palette: Palette { Palette.resolve(paletteChoice) }

    init() {
        let raw = UserDefaults.standard.string(forKey: "taskr.palette") ?? "auto"
        paletteChoice = PaletteChoice(rawValue: raw) ?? .auto
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
        user = nil
        talkOpen = false
    }
}
