import Foundation

/// Display names. Same defaults as the web client config, not baked into the bundle id.
enum Branding {
    static let appName = "Working Title"
    static let assistantName = "Assistant"
    /// Live server. Phone and computer share this account.
    static let apiBase = URL(string: "https://server-production-1374.up.railway.app/api")!
}
