package in.cineamit.app.data;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.TimeUnit;

import in.cineamit.app.CineAmitApp;
import in.cineamit.app.data.Models.LiveChannel;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * MAG/Stalker portal talks on the phone — website/server pe 21k channels nahi chalte.
 */
public final class StalkerClient {
    public static final String PORTAL = "https://sbhgoldpro.org";
    public static final String MAC = "00:1A:79:1B:A5:64";
    public static final String UA =
            "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";

    private static final long CACHE_MS = 6L * 60L * 60L * 1000L;
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
            .addInterceptor(chain -> { in.cineamit.app.AccessGate.requireAllowed(); in.cineamit.app.WebSecurity.requireHttps(chain.request().url()); return chain.proceed(chain.request()); })
            .addNetworkInterceptor(chain -> {
                in.cineamit.app.WebSecurity.requireHttps(chain.request().url());
                if (!isPortalOrigin(chain.request().url().toString())) throw new java.io.IOException("Untrusted portal redirect.");
                return chain.proceed(chain.request());
            })
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build();

    private static String cookie = "mac=" + MAC + "; stb_lang=en; timezone=GMT";
    private static String token = "";

    private StalkerClient() {}

    public static boolean isPortalOrigin(String url) {
        okhttp3.HttpUrl portal = okhttp3.HttpUrl.parse(PORTAL);
        okhttp3.HttpUrl target = okhttp3.HttpUrl.parse(url == null ? "" : url);
        return portal != null && target != null && target.isHttps()
            && target.username().isEmpty() && target.password().isEmpty()
            && portal.host().equals(target.host()) && portal.port() == target.port();
    }

    public static String httpCookie() {
        return cookie;
    }

    public static List<LiveChannel> channels(boolean refresh) {
        if (!refresh) {
            List<LiveChannel> cached = readCache();
            if (cached != null && !cached.isEmpty()) return cached;
        }
        try {
            List<LiveChannel> fresh = fetchAll();
            if (!fresh.isEmpty()) {
                writeCache(fresh);
                return fresh;
            }
        } catch (Exception ignored) {}
        List<LiveChannel> fallback = readCache();
        return fallback != null ? fallback : new ArrayList<>();
    }

    public static String resolvePlay(String cmd) {
        if (cmd == null || cmd.trim().isEmpty()) return null;
        try {
            handshake();
            sleep(1500);
            JSONObject js = mag("itv", "create_link", "cmd", cmd.trim());
            String real = "";
            if (js != null) real = js.optString("cmd", "");
            if (real.toLowerCase().contains("stream=&")) {
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("stream=([0-9]+)", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(cmd);
                if (m.find()) real = real.replaceAll("(?i)stream=&", "stream=" + m.group(1) + "&");
            }
            String url = rewrite(real);
            if (url == null) url = rewrite(cmd);
            return url;
        } catch (Exception e) {
            return rewrite(cmd);
        }
    }

    private static List<LiveChannel> fetchAll() throws Exception {
        handshake();
        sleep(2500);
        JSONArray rows = magList("itv", "get_all_channels");
        if (rows.length() == 0) {
            sleep(3000);
            rows = magList("itv", "get_ordered_list", "p", "0");
        }
        List<LiveChannel> out = new ArrayList<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            String name = row.optString("name", row.optString("title", "")).trim();
            String cmd = row.optString("cmd", row.optString("command", "")).trim();
            if (name.isEmpty() || cmd.isEmpty() || cmd.length() > 2048) continue;
            LiveChannel c = new LiveChannel();
            c.name = name;
            c.logo = row.optString("logo", row.optString("logo_alt", ""));
            c.category = first(row.optString("genre_title"), row.optString("category"), "Live TV");
            c.tvg_id = row.optString("xmltv_id", row.optString("id", ""));
            c.cmd = cmd;
            c.play = "device";
            c.source = "stalker";
            out.add(c);
            if (out.size() >= 25000) break;
        }
        return out;
    }

    private static void handshake() throws Exception {
        JSONObject js = mag("stb", "handshake", "token", "");
        token = js == null ? "" : js.optString("token", "");
        cookie = "mac=" + MAC + "; stb_lang=en; timezone=GMT";
    }

    private static JSONArray magList(String type, String action, String... extra) throws Exception {
        JSONObject js = mag(type, action, extra);
        if (js == null) return new JSONArray();
        Object data = js.opt("data");
        if (data instanceof JSONArray) return (JSONArray) data;
        if (data instanceof JSONObject) {
            JSONArray arr = new JSONArray();
            JSONObject o = (JSONObject) data;
            Iterator<String> it = o.keys();
            while (it.hasNext()) arr.put(o.opt(it.next()));
            return arr;
        }
        return new JSONArray();
    }

    private static JSONObject mag(String type, String action, String... extra) throws Exception {
        HttpUrl.Builder b = HttpUrl.parse(PORTAL + "/server/load.php").newBuilder()
                .addQueryParameter("type", type)
                .addQueryParameter("action", action)
                .addQueryParameter("mac", MAC);
        for (int i = 0; i + 1 < extra.length; i += 2) b.addQueryParameter(extra[i], extra[i + 1]);
        Exception last = null;
        for (int attempt = 0; attempt < 4; attempt++) {
            if (attempt > 0) sleep(2000L * (1L << (attempt - 1)));
            Request.Builder req = new Request.Builder().url(b.build())
                    .header("User-Agent", UA)
                    .header("X-User-Agent", "Model: MAG250; Link: Ethernet")
                    .header("Cookie", cookie)
                    .header("Accept", "application/json, */*");
            if (token != null && !token.isEmpty()) req.header("Authorization", "Bearer " + token);
            try (Response res = HTTP.newCall(req.build()).execute()) {
                int code = res.code();
                String body = res.body() == null ? "" : res.body().string();
                if (code == 429 || code == 503) {
                    last = new RuntimeException("HTTP " + code);
                    continue;
                }
                if (code < 200 || code >= 300 || body.isEmpty()) {
                    last = new RuntimeException("HTTP " + code);
                    continue;
                }
                JSONObject root = new JSONObject(body);
                JSONObject js = root.optJSONObject("js");
                return js != null ? js : root;
            } catch (Exception e) {
                last = e;
            }
        }
        if (last != null) throw last;
        return null;
    }

    public static String rewrite(String cmd) {
        if (cmd == null) return null;
        String raw = cmd.trim().replaceFirst("(?i)^(ffmpeg|auto|copy)\\s+", "").trim();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("https?://[^\\s\"'<>]+", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(raw);
        if (m.find()) raw = m.group().replaceAll("[),;]+$", "");
        if (!raw.startsWith("http")) return null;
        try {
            HttpUrl u = HttpUrl.parse(raw);
            if (u == null) return null;
            String host = u.host();
            if ("localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host) || "0.0.0.0".equals(host) || "::1".equals(host)) {
                HttpUrl portal = HttpUrl.parse(PORTAL);
                if (portal == null) return null;
                u = u.newBuilder().scheme(portal.scheme()).host(portal.host())
                        .port(portal.port()).build();
            }
            return u.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private static File cacheFile() {
        return new File(CineAmitApp.get().getCacheDir(), "stalker_itv.json");
    }

    private static List<LiveChannel> readCache() {
        File f = cacheFile();
        if (!f.isFile() || System.currentTimeMillis() - f.lastModified() > CACHE_MS) return null;
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) Math.min(f.length(), 40L * 1024 * 1024)];
            int n = in.read(buf);
            if (n <= 0) return null;
            JSONArray arr = new JSONArray(new String(buf, 0, n, StandardCharsets.UTF_8));
            List<LiveChannel> out = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                LiveChannel c = new LiveChannel();
                c.name = o.optString("name");
                c.logo = o.optString("logo");
                c.category = o.optString("category", "Live TV");
                c.tvg_id = o.optString("tvg_id");
                c.cmd = o.optString("cmd");
                c.play = "device";
                c.source = "stalker";
                if (!c.name.isEmpty() && !c.cmd.isEmpty()) out.add(c);
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    private static void writeCache(List<LiveChannel> list) {
        try {
            JSONArray arr = new JSONArray();
            for (LiveChannel c : list) {
                JSONObject o = new JSONObject();
                o.put("name", c.name);
                o.put("logo", c.logo);
                o.put("category", c.category);
                o.put("tvg_id", c.tvg_id);
                o.put("cmd", c.cmd);
                arr.put(o);
            }
            byte[] bytes = arr.toString().getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream out = new FileOutputStream(cacheFile())) {
                out.write(bytes);
            }
        } catch (Exception ignored) {}
    }

    private static String first(String a, String b, String c) {
        if (a != null && !a.trim().isEmpty()) return a.trim();
        if (b != null && !b.trim().isEmpty()) return b.trim();
        return c;
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
