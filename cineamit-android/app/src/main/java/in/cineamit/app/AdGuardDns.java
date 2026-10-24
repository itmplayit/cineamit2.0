package in.cineamit.app;

import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.InetAddress;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * WebView cannot set Android Private DNS. Resolve hosts via AdGuard DoH
 * (dns.adguard-dns.com) and sinkhole ads (0.0.0.0 / 127.0.0.1).
 */
public final class AdGuardDns {
    private static final String DOH_HOST = "dns.adguard-dns.com";
    private static final ConcurrentHashMap<String, Boolean> CACHE = new ConcurrentHashMap<>();
    private static OkHttpClient http;

    private AdGuardDns() {}

    private static OkHttpClient http() {
        if (http == null) {
            synchronized (AdGuardDns.class) {
                if (http == null) {
                    http = new OkHttpClient.Builder()
                            .connectTimeout(1500, TimeUnit.MILLISECONDS)
                            .readTimeout(1500, TimeUnit.MILLISECONDS)
                            .writeTimeout(1500, TimeUnit.MILLISECONDS)
                            .callTimeout(1800, TimeUnit.MILLISECONDS)
                            .followRedirects(true)
                            .build();
                }
            }
        }
        return http;
    }

    /** UI thread: cache only, never network. */
    public static boolean cachedBlock(String url) {
        String host = hostOf(url);
        if (host == null) return false;
        Boolean v = CACHE.get(host);
        return v != null && v;
    }

    /** WebView intercept thread: DoH lookup + cache. Fail-open on errors. */
    public static boolean isBlocked(String url) {
        if (url == null || url.isEmpty()) return false;
        String low = url.toLowerCase();
        if (low.startsWith("data:") || low.startsWith("blob:") || low.startsWith("about:")
                || low.startsWith("file:") || low.startsWith("javascript:")) return false;
        if (DownloadCatch.isFileHost(url) || DownloadCatch.looksFile(url)) return false;
        String host = hostOf(url);
        if (host == null) return false;
        if (host.equals(DOH_HOST) || host.endsWith(".adguard-dns.com") || host.endsWith(".adguard.com")) {
            return false;
        }
        Boolean hit = CACHE.get(host);
        if (hit != null) return hit;
        boolean block = lookup(host);
        CACHE.put(host, block);
        if (CACHE.size() > 4000) CACHE.clear();
        return block;
    }

    private static boolean lookup(String host) {
        try {
            HttpUrl url = new HttpUrl.Builder()
                    .scheme("https")
                    .host(DOH_HOST)
                    .addPathSegment("dns-query")
                    .addQueryParameter("name", host)
                    .addQueryParameter("type", "A")
                    .build();
            Request req = new Request.Builder()
                    .url(url)
                    .header("Accept", "application/dns-json")
                    .header("User-Agent", "CineAmit-DoH/1.0")
                    .get()
                    .build();
            try (Response res = http().newCall(req).execute()) {
                if (res.isSuccessful() && res.body() != null) {
                    String body = res.body().string();
                    if (body.startsWith("{")) return sinkholed(body);
                }
            }
            HttpUrl alt = new HttpUrl.Builder()
                    .scheme("https")
                    .host(DOH_HOST)
                    .addPathSegment("resolve")
                    .addQueryParameter("name", host)
                    .addQueryParameter("type", "A")
                    .build();
            Request req2 = new Request.Builder()
                    .url(alt)
                    .header("Accept", "application/dns-json, application/json")
                    .header("User-Agent", "CineAmit-DoH/1.0")
                    .get()
                    .build();
            try (Response res = http().newCall(req2).execute()) {
                if (res.body() == null || !res.isSuccessful()) return false;
                return sinkholed(res.body().string());
            }
        } catch (Exception e) {
            return false;
        }
    }

    static boolean sinkholed(String json) {
        try {
            JSONObject o = new JSONObject(json);
            int status = o.optInt("Status", 0);
            if (status == 3) return true;
            JSONArray ans = o.optJSONArray("Answer");
            if (ans == null || ans.length() == 0) return false;
            boolean anyReal = false;
            boolean anyHole = false;
            for (int i = 0; i < ans.length(); i++) {
                JSONObject a = ans.optJSONObject(i);
                if (a == null) continue;
                int type = a.optInt("type", 0);
                if (type != 0 && type != 1) continue;
                String data = a.optString("data", "").trim();
                if (data.isEmpty()) continue;
                if (isHole(data)) anyHole = true;
                else anyReal = true;
            }
            return anyHole && !anyReal;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean isHole(String ip) {
        String s = ip.toLowerCase();
        if ("0.0.0.0".equals(s) || "127.0.0.1".equals(s) || "::".equals(s) || "::1".equals(s)) return true;
        try {
            byte[] b = InetAddress.getByName(s).getAddress();
            if (b.length == 4) {
                return (b[0] == 0 && b[1] == 0 && b[2] == 0 && b[3] == 0)
                        || (b[0] == 127);
            }
        } catch (Exception ignored) {}
        return false;
    }

    private static String hostOf(String raw) {
        try {
            String host = Uri.parse(raw).getHost();
            if (host == null || host.isEmpty()) return null;
            host = host.toLowerCase();
            while (host.endsWith(".")) host = host.substring(0, host.length() - 1);
            if (host.isEmpty() || host.equals("localhost")) return null;
            char c = host.charAt(0);
            if (c >= '0' && c <= '9') {
                try {
                    InetAddress.getByName(host);
                    return null;
                } catch (Exception ignored) {}
            }
            return host;
        } catch (Exception e) {
            return null;
        }
    }
}
