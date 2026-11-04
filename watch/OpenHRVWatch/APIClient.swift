import Foundation

/// OpenHRV — Watch companion API configuration.
///
/// The watch holds no Cloudflare Access session, so it authenticates to the
/// Worker's token lanes (`/api/watch/*`) with the owner's import token — the
/// same per-owner token the iOS Shortcuts use (OpenHRV → More → Settings &
/// connections). Paste it once in the companion's Settings tab.
enum APIConfig {
    static let baseURL = URL(string: "https://openhrv.barkleesanders.workers.dev")!
    private static let tokenKey = "openhrv.importToken"

    static var importToken: String {
        get { UserDefaults.standard.string(forKey: tokenKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: tokenKey) }
    }

    static var isConfigured: Bool { !importToken.isEmpty }
}

enum APIError: Error, LocalizedError {
    case notConfigured
    case http(Int)
    case empty

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Add your OpenHRV import token in Settings (on this watch) first."
        case .http(let code):
            return "Server returned HTTP \(code)."
        case .empty:
            return "Empty response from the server."
        }
    }
}

actor APIClient {
    static let shared = APIClient()

    func fetchToday() async throws -> TodayResponse {
        let data = try await request(path: "/api/watch/today", method: "GET", body: nil)
        return try JSONDecoder().decode(TodayResponse.self, from: data)
    }

    @discardableResult
    func postMeasurement(rrMs: [Double], source: String = "watch") async throws -> MeasurementResponse {
        let payload: [String: Any] = ["rr_ms": rrMs, "source": source]
        let data = try await request(
            path: "/api/watch/measurements",
            method: "POST",
            body: JSONSerialization.data(withJSONObject: payload)
        )
        return try JSONDecoder().decode(MeasurementResponse.self, from: data)
    }

    private func request(path: String, method: String, body: Data?) async throws -> Data {
        guard APIConfig.isConfigured else { throw APIError.notConfigured }
        var req = URLRequest(url: APIConfig.baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("Bearer \(APIConfig.importToken)", forHTTPHeaderField: "Authorization")
        if body != nil {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.empty }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
        return data
    }
}
