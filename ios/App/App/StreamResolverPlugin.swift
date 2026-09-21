import Capacitor
import Foundation

@objc(StreamResolverPlugin)
public final class StreamResolverPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StreamResolverPlugin"
    public let jsName = "StreamResolver"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "resolve", returnType: CAPPluginReturnPromise),
    ]

    @objc public func resolve(_ call: CAPPluginCall) {
        guard let rawURL = call.getString("url"), let target = URL(string: rawURL),
              target.scheme == "https", target.path == "/embed.php",
              let host = target.host, host.range(of: #"^embed\d{1,3}\.streamc\.xyz$"#, options: [.regularExpression, .caseInsensitive]) != nil,
              let components = URLComponents(url: target, resolvingAgainstBaseURL: false), components.queryItems?.count == 1,
              components.queryItems?.first?.name == "hash",
              let hash = components.queryItems?.first?.value,
              hash.range(of: #"^[a-f0-9]{32}$"#, options: [.regularExpression, .caseInsensitive]) != nil,
              let rawReferrer = call.getString("referrer"), let referrer = URL(string: rawReferrer),
              referrer.scheme == "https", referrer.host == "phim.nguonc.com" else {
            call.reject("Invalid backup stream request.")
            return
        }
        var request = URLRequest(url: target, timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("application/json, text/plain, */*", forHTTPHeaderField: "Accept")
        request.setValue("vi,en-US;q=0.8,en;q=0.6", forHTTPHeaderField: "Accept-Language")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("https://\(host)", forHTTPHeaderField: "Origin")
        request.setValue(target.absoluteString, forHTTPHeaderField: "Referer")
        request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Phim4KiOS", forHTTPHeaderField: "User-Agent")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "action": "bootstrap", "referrer": referrer.absoluteString,
            "frame_origins": ["https://phim.nguonc.com"], "request_grant": true,
            "playlist_format": "hls", "pretty_url": true, "path_chunks": true, "bootstrap_format": "json",
        ])
        URLSession.shared.dataTask(with: request) { data, response, error in
            guard error == nil, let http = response as? HTTPURLResponse, http.statusCode == 200, let data,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let preissued = object["preissued"] as? [String: Any], preissued["playlistFormat"] as? String == "hls",
                  let rawPlaylist = preissued["playlist"] as? String, let playlist = URL(string: rawPlaylist),
                  playlist.scheme == "https", playlist.host?.caseInsensitiveCompare(host) == .orderedSame else {
                call.reject("Backup stream could not be resolved.")
                return
            }
            call.resolve(["playlist": playlist.absoluteString])
        }.resume()
    }
}
