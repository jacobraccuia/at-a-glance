import Foundation

enum APIError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

final class APIClient {
    private let base = Branding.apiBase
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init() {
        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.httpCookieStorage = HTTPCookieStorage.shared
        session = URLSession(configuration: config)
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        try await send("GET", path: path, body: Optional<String>.none)
    }

    func post<T: Decodable>(_ path: String, body: (any Encodable)? = nil) async throws -> T {
        try await send("POST", path: path, body: body)
    }

    func postVoid(_ path: String, body: (any Encodable)? = nil) async throws {
        let _: Empty = try await send("POST", path: path, body: body)
    }

    func discard(_ path: String) async throws {
        var request = URLRequest(url: url(path))
        request.httpMethod = "POST"
        let (data, response) = try await session.data(for: request)
        try check(response, data: data, allowEmpty: true)
    }

    func patch<T: Decodable>(_ path: String, body: any Encodable) async throws -> T {
        try await send("PATCH", path: path, body: body)
    }

    func data(_ path: String, json: any Encodable) async throws -> Data {
        var request = URLRequest(url: url(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(AnyEncodable(json))
        let (data, response) = try await session.data(for: request)
        try check(response, data: data, allowEmpty: false)
        return data
    }

    private func send<T: Decodable>(_ method: String, path: String, body: (any Encodable)?) async throws -> T {
        var request = URLRequest(url: url(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body {
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }
        let (data, response) = try await session.data(for: request)
        try check(response, data: data, allowEmpty: T.self == Empty.self)
        if T.self == Empty.self, data.isEmpty {
            return Empty() as! T
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.message("Could not read the server response.")
        }
    }

    private func url(_ path: String) -> URL {
        var root = base.absoluteString
        if !root.hasSuffix("/") { root += "/" }
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return URL(string: root + trimmed) ?? base
    }

    private func check(_ response: URLResponse, data: Data, allowEmpty: Bool) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.message("No response")
        }
        if (200..<300).contains(http.statusCode) { return }
        if allowEmpty, http.statusCode == 204 { return }
        let text = String(data: data, encoding: .utf8) ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
        throw APIError.message(text)
    }
}

private struct Empty: Decodable {}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
