package com.phim4k.cinema;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

@CapacitorPlugin(name = "StreamResolver")
public class StreamResolverPlugin extends Plugin {
    private static final Pattern HOST = Pattern.compile("^embed\\d{1,3}\\.streamc\\.xyz$", Pattern.CASE_INSENSITIVE);
    private static final Pattern HASH = Pattern.compile("^[a-f0-9]{32}$", Pattern.CASE_INSENSITIVE);

    @PluginMethod
    public void resolve(PluginCall call) {
        new Thread(() -> {
            try {
                URI target = URI.create(call.getString("url", ""));
                URI referrer = URI.create(call.getString("referrer", ""));
                String query = target.getRawQuery() == null ? "" : target.getRawQuery();
                String hash = query.startsWith("hash=") && query.indexOf('&') < 0 ? query.substring(5) : "";
                if (!"https".equalsIgnoreCase(target.getScheme()) || !HOST.matcher(target.getHost()).matches()
                    || !"/embed.php".equals(target.getPath()) || !HASH.matcher(hash).matches()
                    || !"https".equalsIgnoreCase(referrer.getScheme()) || !"phim.nguonc.com".equalsIgnoreCase(referrer.getHost())) {
                    throw new IllegalArgumentException("Invalid backup stream request.");
                }
                HttpsURLConnection connection = (HttpsURLConnection) target.toURL().openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Accept", "application/json, text/plain, */*");
                connection.setRequestProperty("Accept-Language", "vi,en-US;q=0.8,en;q=0.6");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Origin", target.getScheme() + "://" + target.getHost());
                connection.setRequestProperty("Referer", target.toString());
                connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36 Phim4KAndroid");
                JSONObject body = new JSONObject()
                    .put("action", "bootstrap").put("referrer", referrer.toString())
                    .put("frame_origins", new org.json.JSONArray().put("https://phim.nguonc.com"))
                    .put("request_grant", true).put("playlist_format", "hls")
                    .put("pretty_url", true).put("path_chunks", true).put("bootstrap_format", "json");
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                if (connection.getResponseCode() != 200) throw new IllegalStateException("Backup stream rejected (" + connection.getResponseCode() + ").");
                StringBuilder text = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    for (String line; (line = reader.readLine()) != null;) text.append(line);
                }
                JSONObject preissued = new JSONObject(text.toString()).getJSONObject("preissued");
                URI playlist = URI.create(preissued.getString("playlist"));
                if (!"hls".equals(preissued.optString("playlistFormat")) || !"https".equalsIgnoreCase(playlist.getScheme())
                    || !target.getHost().equalsIgnoreCase(playlist.getHost())) throw new IllegalStateException("Invalid backup playlist.");
                call.resolve(new JSObject().put("playlist", playlist.toString()));
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "Backup stream failed." : error.getMessage());
            }
        }, "phim4k-stream-resolver").start();
    }
}
