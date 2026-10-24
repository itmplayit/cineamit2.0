package in.cineamit.app.data;

import in.cineamit.app.AdBlock;
import in.cineamit.app.AccessGate;
import in.cineamit.app.WebSecurity;
import in.cineamit.app.CineAmitApp;
import in.cineamit.app.data.Models.AppUser;
import in.cineamit.app.data.Models.CastPerson;
import in.cineamit.app.data.Models.Episode;
import in.cineamit.app.data.Models.HomeRow;
import in.cineamit.app.data.Models.LiveChannel;
import in.cineamit.app.data.Models.MediaItem;
import in.cineamit.app.data.Models.Provider;
import in.cineamit.app.data.Models.Season;
import in.cineamit.app.data.Models.Server;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.data.Models.Studio;
import in.cineamit.app.data.Models.UserProfile;
import in.cineamit.app.data.Models.VodEpisode;
import in.cineamit.app.data.Models.VodItem;
import in.cineamit.app.data.Models.VodSeason;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.Cache;
import okhttp3.FormBody;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

import java.io.File;

public final class Api {
    private static final String EMBED_UA =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    private static OkHttpClient client;

    private Api() {}

    public static OkHttpClient client() {
        if (client == null) {
            File cacheDir = new File(CineAmitApp.get().getCacheDir(), "http");
            client = new OkHttpClient.Builder()
                    .cookieJar(PersistentCookieJar.get())
                    .cache(new Cache(cacheDir, 40L * 1024 * 1024))
                    .followRedirects(true)
                    .followSslRedirects(true)
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(25, TimeUnit.SECONDS)
                    .addInterceptor(chain -> { AccessGate.requireAllowed(); WebSecurity.requireAppRequest(chain.request()); return chain.proceed(chain.request()); })
                    .addNetworkInterceptor(chain -> {
                        okhttp3.Request req = chain.request();
                        WebSecurity.requireAppRequest(req); // Also checks every followed redirect before any request bytes.
                        Response res = chain.proceed(req);
                        String host = req.url().host();
                        if (host.contains("image.tmdb.org")) {
                            return res.newBuilder()
                                    .header("Cache-Control", "public, max-age=604800")
                                    .removeHeader("Pragma")
                                    .build();
                        }
                        if ("application/json".equals(req.header("Accept"))
                                || "app".equals(req.header("X-Cine-Client"))) {
                            return res.newBuilder()
                                    .header("Cache-Control", "no-store")
                                    .removeHeader("Pragma")
                                    .build();
                        }
                        return res;
                    })
                    .build();
        }
        return client;
    }

    public static String abs(String path) {
        if (path == null) return "";
        if (path.startsWith("http")) return path;
        return CineAmitApp.baseUrl() + (path.startsWith("/") ? path : "/" + path);
    }

    public static void syncCookiesToWebView() {
        try {
            android.webkit.CookieManager wm = android.webkit.CookieManager.getInstance();
            wm.setAcceptCookie(true);
            PersistentCookieJar.get().copyToWebView(wm);
            wm.flush();
        } catch (Exception ignored) {}
    }

    public static final class PlaybackAccessException extends java.io.IOException {
        public final String reason;
        PlaybackAccessException(String reason,String message) {super(message);this.reason=reason;}
    }
    public static String resolveEmbed(String url) throws PlaybackAccessException {
        OkHttpClient noFollow=client().newBuilder().followRedirects(false).followSslRedirects(false).build();
        String current=url;
        for (int i=0;i<10;i++) {
            String next;
            try {
                Request req=new Request.Builder().url(current).header("Accept","application/json,text/html").header("User-Agent",EMBED_UA).head().build();
                try (Response res=noFollow.newCall(req).execute()) {next=hop(res,current,true);}
            } catch (PlaybackAccessException denied) {throw denied;}
            catch (Exception headError) {
                try {
                    Request req=new Request.Builder().url(current).header("Accept","application/json,text/html").header("User-Agent",EMBED_UA).get().build();
                    try (Response res=noFollow.newCall(req).execute()) {next=hop(res,current,false);}
                } catch (PlaybackAccessException denied) {throw denied;}
                catch (Exception networkError) {return null;}
            }
            if (next==null) return null;
            if (next.equals(current)) return current.contains("/api/secure_play") ? null:current;
            if (!next.contains("/api/secure_play")) return next;
            current=next;
        }
        return null;
    }
    private static String hop(Response res,String current,boolean headFallback) throws PlaybackAccessException {
        String loc=res.header("Location");
        if (res.code()>=300 && res.code()<=399 && loc!=null && !loc.isEmpty()) {
            okhttp3.HttpUrl resolved=res.request().url().resolve(loc);
            return resolved!=null ? resolved.toString():loc;
        }
        if (res.code()>=200 && res.code()<=399) return current;
        if (headFallback) throw new IllegalStateException("head_fallback");
        if (current.contains("/api/secure_play")) {
            String reason="player_unavailable";
            long reset=0;
            try {
                JSONObject body=new JSONObject(res.peekBody(8192).string());
                reason=body.optString("error",reason);
                JSONObject quota=body.optJSONObject("quota");
                if (quota!=null) reset=quota.optLong("reset_at",0);
            } catch (Exception malformed) {}
            if ("watch_limit".equals(reason)) {
                String when="12 AM IST";
                if (reset>System.currentTimeMillis() && reset<System.currentTimeMillis()+172800000L) {
                    java.text.SimpleDateFormat fmt=new java.text.SimpleDateFormat("d MMM, h:mm a",java.util.Locale.getDefault());
                    fmt.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Kolkata"));when=fmt.format(new java.util.Date(reset))+" IST";
                }
                throw new PlaybackAccessException(reason,"Daily unlock limit reached. New titles reset at "+when+". Previously unlocked titles can be replayed today.");
            }
            if (res.code()==503) throw new PlaybackAccessException(reason,"Player access is temporarily unavailable. Retry shortly; no new access was confirmed.");
            if (res.code()==403) throw new PlaybackAccessException(reason,"This title is unavailable for the active profile.");
            throw new PlaybackAccessException(reason,"Player link expired or unavailable. Reopen the watch page and try again.");
        }
        return null;
    }

    public static String img(String imageBase, String path) {
        return img(imageBase, path, "original");
    }

    public static String img(String imageBase, String path, String size) {
        if (path == null || path.isEmpty() || "null".equals(path)) return "";
        if (path.startsWith("http")) return path;
        String base = (imageBase == null || imageBase.isEmpty()) ? "https://image.tmdb.org/t/p" : imageBase;
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        if (size == null || size.isEmpty()) size = "original";
        return base + "/" + size + (path.startsWith("/") ? path : "/" + path);
    }

    private static HttpUrl jsonUrl(String path) {
        HttpUrl parsed = HttpUrl.parse(abs(path));
        if (parsed == null) return null;
        return parsed.newBuilder().setQueryParameter("format", "json").build();
    }

    private static Request.Builder jsonReq(HttpUrl url) {
        return new Request.Builder()
                .url(url)
                .header("Accept", "application/json")
                .header("User-Agent", EMBED_UA)
                .header("X-Cine-Client", "app");
    }

    private static JSONObject jsonOrError(String body, int code) {
        String trimmed = body == null ? "" : body.trim();
        if (!trimmed.isEmpty() && trimmed.charAt(0) == '\uFEFF') trimmed = trimmed.substring(1).trim();
        if (trimmed.startsWith("{")) {
            try {
                JSONObject o = new JSONObject(trimmed);
                if (code == 401 && o.optString("error").isEmpty()) o.put("error", "login_required");
                if (code == 403 && o.optString("error").isEmpty()) o.put("error", "kids_restricted");
                if (code >= 400 && !o.has("ok")) o.put("ok", false);
                return o;
            } catch (Exception e) {
                return err("bad_json");
            }
        }
        if (trimmed.startsWith("[")) {
            try {
                return new JSONObject().put("ok", code < 400).put("episodes", new JSONArray(trimmed)).put("items", new JSONArray(trimmed));
            } catch (Exception e) {
                return err("bad_json");
            }
        }
        if (trimmed.isEmpty()) {
            if (code == 401) return err("login_required");
            if (code == 403) return err("kids_restricted");
            if (code >= 200 && code < 300) {
                try { return new JSONObject().put("ok", true); } catch (Exception e) { return err("empty"); }
            }
            return err("http_" + code);
        }
        String low = trimmed.toLowerCase();
        if (low.startsWith("<!doctype") || low.startsWith("<html") || low.startsWith("<")) {
            return err("html");
        }
        String err = code == 401 ? "login_required" : code == 403 ? "kids_restricted" : "http_" + code;
        return err(err);
    }

    private static JSONObject err(String error) {
        try {
            return new JSONObject().put("ok", false).put("error", error);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static JSONObject get(String path) {
        return get(path, 25);
    }

    private static JSONObject get(String path, long readSeconds) {
        try {
            HttpUrl url = jsonUrl(path);
            if (url == null) return err("bad_url");
            OkHttpClient http = client().newBuilder()
                    .cache(null)
                    .readTimeout(readSeconds, TimeUnit.SECONDS)
                    .connectTimeout(Math.max(15, Math.min(30, readSeconds)), TimeUnit.SECONDS)
                    .build();
            Request req = jsonReq(url).get().build();
            try (Response res = http.newCall(req).execute()) {
                String body = res.body() != null ? res.body().string() : "";
                return jsonOrError(body, res.code());
            }
        } catch (Exception e) {
            throw wrap(e);
        }
    }

    private static JSONObject postJson(String path, JSONObject body) {
        try {
            HttpUrl url = jsonUrl(path);
            if (url == null) return err("bad_url");
            MediaType json = MediaType.parse("application/json; charset=utf-8");
            RequestBody rb = RequestBody.create(body == null ? "{}" : body.toString(), json);
            Request req = jsonReq(url).post(rb).build();
            OkHttpClient http = client().newBuilder().cache(null).build();
            try (Response res = http.newCall(req).execute()) {
                String text = res.body() != null ? res.body().string() : "";
                return jsonOrError(text, res.code());
            }
        } catch (Exception e) {
            throw wrap(e);
        }
    }

    private static JSONObject postForm(String path, Map<String, String> fields) {
        try {
            HttpUrl url = jsonUrl(path);
            if (url == null) return err("bad_url");
            FormBody.Builder form = new FormBody.Builder();
            if (fields != null) {
                for (Map.Entry<String, String> e : fields.entrySet()) form.add(e.getKey(), e.getValue());
            }
            Request req = jsonReq(url).post(form.build()).build();
            OkHttpClient http = client().newBuilder().cache(null).build();
            try (Response res = http.newCall(req).execute()) {
                String body = res.body() != null ? res.body().string() : "";
                return jsonOrError(body, res.code());
            }
        } catch (Exception e) {
            throw wrap(e);
        }
    }

    private static JSONObject getUrl(HttpUrl url) {
        try {
            if (url == null) return err("bad_url");
            HttpUrl json = url.newBuilder().setQueryParameter("format", "json").build();
            Request req = jsonReq(json).get().build();
            OkHttpClient http = client().newBuilder().cache(null).build();
            try (Response res = http.newCall(req).execute()) {
                String body = res.body() != null ? res.body().string() : "";
                return jsonOrError(body, res.code());
            }
        } catch (Exception e) {
            throw wrap(e);
        }
    }

    private static RuntimeException wrap(Exception e) {
        return e instanceof RuntimeException ? (RuntimeException) e : new RuntimeException(e.getMessage(), e);
    }

    public static JSONObject bootstrap() { return get("/api/app/bootstrap"); }
    public static JSONObject appUpdate() { return get("/api/app/update"); }
    public static JSONObject home() { return get("/api/app/home", 90); }
    private static final Map<String, String> logoCache = new java.util.concurrent.ConcurrentHashMap<>();

    public static void rememberLogo(String type, long id, String path) {
        if (type == null || id <= 0) return;
        logoCache.put(type + ":" + id, path == null ? "" : path);
    }

    public static JSONObject titleLogo(String type, long id) {
        String key = (type == null ? "movie" : type) + ":" + id;
        if (logoCache.containsKey(key)) {
            String cached = logoCache.get(key);
            try {
                return new JSONObject().put("ok", true).put("logo_path", cached == null ? "" : cached);
            } catch (Exception e) {
                return err("logo");
            }
        }
        JSONObject d = get("/api/app/title_logo/" + type + "/" + id);
        String path = d.optString("logo_path");
        if (path == null || "null".equalsIgnoreCase(path)) path = "";
        rememberLogo(type, id, path);
        try {
            return new JSONObject().put("ok", true).put("logo_path", path);
        } catch (Exception e) {
            return err("logo");
        }
    }
    public static JSONObject search(String q) {
        HttpUrl base = HttpUrl.parse(abs("/api/app/search"));
        if (base == null) return err("bad_url");
        return getUrl(base.newBuilder().addQueryParameter("q", q).build());
    }
    public static JSONObject details(String type, long id) { return get("/api/app/details/" + type + "/" + id); }
    public static JSONObject watch(String type, long id, int s, int e) {
        return get("/api/app/watch/" + type + "/" + id + "?s=" + s + "&e=" + e);
    }
    public static JSONObject episodes(long id, int season) { return get("/api/app/episodes/" + id + "/" + season); }
    public static JSONObject studios() { return get("/api/app/studios"); }
    public static JSONObject studio(long id) { return studio(id, 1); }
    public static JSONObject studio(long id, int page) { return get("/api/app/studio/" + id + "?page=" + page); }
    public static JSONObject providers() { return get("/api/app/providers"); }
    public static JSONObject provider(long id) { return provider(id, 1); }
    public static JSONObject provider(long id, int page) { return get("/api/app/provider/" + id + "?page=" + page); }
    public static JSONObject livetv() { return livetv(1, "", "All", "all"); }
    public static JSONObject livetv(int page, String q, String category, String source) {
        JSONObject api = livetvOnce("/api/app/livetv", page, q, category, source, page <= 1);
        if (liveRowCount(api) > 0) return api;
        String apiErr = api.optString("error");
        if ("login_required".equals(apiErr) || "kids_restricted".equals(apiErr)) return api;
        JSONObject html = livetvFromWebsite(page, q, category, source);
        if (liveRowCount(html) > 0) return html;
        String htmlErr = html.optString("error");
        if ("login_required".equals(htmlErr) || "kids_restricted".equals(htmlErr)) return html;
        JSONObject alt = livetvOnce("/livetv", page, q, category, source, false);
        if (liveRowCount(alt) > 0) return alt;
        return api.has("channels") ? api : html;
    }

    private static JSONObject livetvOnce(String path, int page, String q, String category, String source, boolean refresh) {
        HttpUrl parsed = HttpUrl.parse(abs(path));
        if (parsed == null) return err("bad_url");
        HttpUrl.Builder b = parsed.newBuilder()
                .setQueryParameter("format", "json")
                .setQueryParameter("page", String.valueOf(Math.max(1, page)))
                .setQueryParameter("per", "40");
        if (refresh) b.setQueryParameter("refresh", "1");
        if (q != null && !q.trim().isEmpty()) b.setQueryParameter("q", q.trim());
        if (category != null && !category.trim().isEmpty() && !"All".equalsIgnoreCase(category.trim())) {
            b.setQueryParameter("category", category.trim());
        }
        if (source != null && !source.trim().isEmpty() && !"all".equalsIgnoreCase(source.trim())) {
            b.setQueryParameter("source", source.trim());
        }
        try {
            OkHttpClient http = client().newBuilder()
                    .cache(null)
                    .readTimeout(180, TimeUnit.SECONDS)
                    .connectTimeout(30, TimeUnit.SECONDS)
                    .build();
            Request req = jsonReq(b.build()).get().build();
            try (Response res = http.newCall(req).execute()) {
                String body = res.body() != null ? res.body().string() : "";
                JSONObject o = jsonOrError(body, res.code());
                if (liveRowCount(o) > 0) return o;
                JSONObject scraped = scrapeLiveHtml(body);
                if (scraped != null && liveRowCount(scraped) > 0) return pageLive(parseLive(scraped), page, q, category, source);
                if ((body == null || body.trim().isEmpty()) && res.code() >= 200 && res.code() < 300) {
                    return err("live_unavailable");
                }
                return o;
            }
        } catch (Exception e) {
            throw wrap(e);
        }
    }

    private static final Object LIVE_HTML_LOCK = new Object();
    private static List<LiveChannel> liveHtmlCache;
    private static long liveHtmlCacheAt;

    private static JSONObject livetvFromWebsite(int page, String q, String category, String source) {
        synchronized (LIVE_HTML_LOCK) {
            if (liveHtmlCache != null && System.currentTimeMillis() - liveHtmlCacheAt < 180_000L) {
                return pageLive(liveHtmlCache, page, q, category, source);
            }
        }
        HttpUrl parsed = HttpUrl.parse(abs("/livetv"));
        if (parsed == null) return err("bad_url");
        try {
            OkHttpClient http = client().newBuilder()
                    .cache(null)
                    .followRedirects(true)
                    .followSslRedirects(true)
                    .readTimeout(180, TimeUnit.SECONDS)
                    .connectTimeout(30, TimeUnit.SECONDS)
                    .build();
            Request req = new Request.Builder()
                    .url(parsed)
                    .header("Accept", "text/html,application/xhtml+xml,application/json")
                    .header("User-Agent", EMBED_UA)
                    .header("Referer", abs("/"))
                    .get()
                    .build();
            try (Response res = http.newCall(req).execute()) {
                String body = res.body() != null ? res.body().string() : "";
                int code = res.code();
                String finalUrl = res.request().url().encodedPath();
                boolean loginPage = code == 401
                        || (finalUrl != null && finalUrl.contains("/login"))
                        || (body != null && body.toLowerCase().contains("please log in to access")
                            && body.indexOf("channel-data") < 0);
                if (loginPage) return err("login_required");
                List<LiveChannel> rows = extractLiveFromHtml(body);
                if (rows.isEmpty()) return err(code >= 400 ? "html" : "empty");
                synchronized (LIVE_HTML_LOCK) {
                    liveHtmlCache = rows;
                    liveHtmlCacheAt = System.currentTimeMillis();
                }
                return pageLive(rows, page, q, category, source);
            }
        } catch (Exception e) {
            throw wrap(e);
        }
    }

    private static List<LiveChannel> extractLiveFromHtml(String body) {
        List<LiveChannel> rows = new ArrayList<>();
        if (body == null || body.length() < 20) return rows;
        String blob = extractChannelDataBlob(body);
        if (blob != null && !blob.isEmpty()) {
            rows = parseLiveObjects(blob);
            if (rows.isEmpty()) {
                try {
                    rows = parseLive(new JSONArray(blob));
                } catch (Exception ignored) {}
            }
        }
        if (rows.isEmpty()) rows = scrapeLiveLoose(blob != null ? blob : body);
        return rows;
    }

    private static String extractChannelDataBlob(String body) {
        int marker = body.indexOf("id=\"channel-data\"");
        if (marker < 0) marker = body.indexOf("id='channel-data'");
        if (marker < 0) marker = body.indexOf("channel-data");
        if (marker < 0) marker = body.indexOf("channels_json");
        if (marker < 0) return null;
        int start = body.indexOf('[', marker);
        if (start < 0) return null;
        int scriptEnd = body.indexOf("</script>", start);
        if (scriptEnd < 0) scriptEnd = Math.min(body.length(), start + 8_000_000);
        int end = body.lastIndexOf(']', scriptEnd);
        if (end <= start) return null;
        return body.substring(start, end + 1).trim();
    }

    private static List<LiveChannel> parseLiveObjects(String json) {
        List<LiveChannel> out = new ArrayList<>();
        if (json == null) return out;
        int i = 0;
        int n = json.length();
        int guard = 0;
        while (i < n && guard < 25000) {
            int start = json.indexOf('{', i);
            if (start < 0) break;
            int end = matchBrace(json, start);
            if (end < 0) break;
            try {
                LiveChannel c = oneLive(new JSONObject(json.substring(start, end + 1)));
                if (c != null) out.add(c);
            } catch (Exception ignored) {}
            i = end + 1;
            guard++;
        }
        return out;
    }

    private static int matchBrace(String s, int start) {
        int depth = 0;
        boolean inStr = false;
        boolean esc = false;
        for (int i = start; i < s.length(); i++) {
            char c = s.charAt(i);
            if (inStr) {
                if (esc) esc = false;
                else if (c == '\\') esc = true;
                else if (c == '"') inStr = false;
                continue;
            }
            if (c == '"') { inStr = true; continue; }
            if (c == '{') depth++;
            else if (c == '}') {
                depth--;
                if (depth == 0) return i;
            }
        }
        return -1;
    }

    private static LiveChannel oneLive(JSONObject o) {
        if (o == null) return null;
        String name = firstNonEmpty(o, "name", "title", "stream_display_name", "channel_name", "tvg_name", "tvg-name");
        if (name.isEmpty()) return null;
        LiveChannel c = new LiveChannel();
        c.name = name;
        c.logo = absIfNeeded(firstNonEmpty(o, "logo", "stream_icon", "tvg_logo", "tvg-logo"));
        String cat = firstNonEmpty(o, "category", "group", "group-title");
        c.category = cat.isEmpty() ? "All" : cat;
        c.tvg_id = firstNonEmpty(o, "tvg_id", "tvg-id", "epg_channel_id");
        String play = firstNonEmpty(o, "play", "url", "stream", "link");
        c.play = absIfNeeded(play);
        c.source = o.optString("source");
        return c;
    }

    private static JSONObject pageLive(List<LiveChannel> all, int page, String q, String category, String source) {
        String needle = q == null ? "" : q.trim().toLowerCase();
        boolean anyCat = category != null && !category.trim().isEmpty() && !"All".equalsIgnoreCase(category.trim());
        boolean anySrc = source != null && !source.trim().isEmpty() && !"all".equalsIgnoreCase(source.trim());
        List<LiveChannel> filtered = new ArrayList<>();
        LinkedHashSet<String> cats = new LinkedHashSet<>();
        LinkedHashSet<String> srcs = new LinkedHashSet<>();
        cats.add("All");
        srcs.add("all");
        for (LiveChannel c : all) {
            if (c == null || c.name == null || c.name.isEmpty()) continue;
            if (c.category != null && !c.category.isEmpty()) cats.add(c.category);
            if (c.source != null && !c.source.isEmpty()) srcs.add(c.source);
            if (anySrc && c.source != null && !c.source.isEmpty() && !source.equalsIgnoreCase(c.source)) continue;
            if (anyCat && c.category != null && !c.category.isEmpty() && !category.equalsIgnoreCase(c.category)) continue;
            if (!needle.isEmpty()) {
                String blob = (c.name + " " + (c.category == null ? "" : c.category)).toLowerCase();
                if (!blob.contains(needle)) continue;
            }
            filtered.add(c);
        }
        int per = 40;
        int total = filtered.size();
        int pages = Math.max(1, (total + per - 1) / per);
        int p = Math.max(1, page);
        int from = Math.min((p - 1) * per, total);
        int to = Math.min(from + per, total);
        try {
            JSONArray arr = new JSONArray();
            for (int i = from; i < to; i++) {
                LiveChannel c = filtered.get(i);
                JSONObject o = new JSONObject();
                o.put("name", c.name == null ? "" : c.name);
                o.put("logo", c.logo == null ? "" : c.logo);
                o.put("category", c.category == null || c.category.isEmpty() ? "All" : c.category);
                o.put("play", c.play == null ? "" : c.play);
                o.put("url", c.play == null ? "" : c.play);
                o.put("source", c.source == null ? "" : c.source);
                o.put("tvg_id", c.tvg_id == null ? "" : c.tvg_id);
                arr.put(o);
            }
            JSONArray catArr = new JSONArray();
            for (String s : cats) catArr.put(s);
            JSONArray srcArr = new JSONArray();
            for (String s : srcs) srcArr.put(s);
            return new JSONObject()
                    .put("ok", true)
                    .put("channels", arr)
                    .put("categories", catArr)
                    .put("sources", srcArr)
                    .put("page", p)
                    .put("per", per)
                    .put("total", total)
                    .put("total_pages", pages);
        } catch (Exception e) {
            return err("bad_json");
        }
    }

    private static JSONObject scrapeLiveHtml(String body) {
        if (body == null || body.length() < 20) return null;
        int marker = body.indexOf("id=\"channel-data\"");
        if (marker < 0) marker = body.indexOf("id='channel-data'");
        if (marker < 0) marker = body.indexOf("id=\"channel-data\"");
        if (marker < 0) {
            marker = body.indexOf("channels_json");
        }
        if (marker < 0) return null;
        int scriptEnd = body.indexOf("</script>", marker);
        int start = body.indexOf('[', marker);
        if (start < 0) return null;
        if (scriptEnd < 0 || start > scriptEnd) scriptEnd = body.indexOf("</script>", start);
        if (scriptEnd < 0) scriptEnd = Math.min(body.length(), start + 6_000_000);
        String json = body.substring(start, scriptEnd).trim();
        if (json.endsWith(";")) json = json.substring(0, json.length() - 1).trim();
        try {
            JSONArray arr = new JSONArray(json);
            return new JSONObject().put("ok", true).put("channels", arr);
        } catch (Exception e) {
            int endArr = json.lastIndexOf(']');
            if (endArr > 0) {
                try {
                    JSONArray arr = new JSONArray(json.substring(0, endArr + 1));
                    return new JSONObject().put("ok", true).put("channels", arr);
                } catch (Exception ignored) {}
            }
            return null;
        }
    }

    private static List<LiveChannel> scrapeLiveLoose(String body) {
        List<LiveChannel> out = new ArrayList<>();
        if (body == null) return out;
        Pattern p = Pattern.compile("\\{\\s*\"name\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"([\\s\\S]*?)\\}");
        Matcher m = p.matcher(body);
        int n = 0;
        while (m.find() && n < 8000) {
            String name = m.group(1);
            if (name == null) continue;
            name = name.replace("\\\"", "\"").replace("\\\\", "\\").trim();
            if (name.isEmpty()) continue;
            String block = m.group(0);
            LiveChannel c = new LiveChannel();
            c.name = name;
            c.logo = extractJsonString(block, "logo");
            c.category = extractJsonString(block, "category");
            if (c.category.isEmpty()) c.category = "All";
            String play = extractJsonString(block, "play");
            if (play.isEmpty()) play = extractJsonString(block, "url");
            c.play = absIfNeeded(play);
            c.logo = absIfNeeded(c.logo);
            c.source = extractJsonString(block, "source");
            out.add(c);
            n++;
        }
        return out;
    }

    private static String extractJsonString(String block, String key) {
        Matcher m = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"").matcher(block);
        if (!m.find()) return "";
        String v = m.group(1);
        return v == null ? "" : v.replace("\\\"", "\"").replace("\\\\", "\\").trim();
    }

    private static String absIfNeeded(String v) {
        if (v == null || v.isEmpty() || "null".equalsIgnoreCase(v)) return "";
        if (v.startsWith("/")) return abs(v);
        return v;
    }

    public static JSONArray liveArray(JSONObject json) {
        if (json == null) return null;
        String[] keys = { "channels", "items", "data", "results", "list", "live" };
        for (String k : keys) {
            JSONArray a = json.optJSONArray(k);
            if (a != null && a.length() > 0) return a;
            JSONObject nested = json.optJSONObject(k);
            if (nested != null) {
                JSONArray mapped = objectToArray(nested);
                if (mapped != null && mapped.length() > 0) return mapped;
                JSONArray inner = nested.optJSONArray("channels");
                if (inner != null && inner.length() > 0) return inner;
                inner = nested.optJSONArray("items");
                if (inner != null && inner.length() > 0) return inner;
            }
        }
        for (String k : keys) {
            JSONArray a = json.optJSONArray(k);
            if (a != null) return a;
        }
        return null;
    }

    private static JSONArray objectToArray(JSONObject obj) {
        if (obj == null) return null;
        JSONArray a = new JSONArray();
        Iterator<String> keys = obj.keys();
        while (keys.hasNext()) {
            Object v = obj.opt(keys.next());
            if (v instanceof JSONObject) a.put(v);
        }
        return a.length() == 0 ? null : a;
    }

    private static int liveRowCount(JSONObject json) {
        return parseLive(json).size();
    }
    public static JSONObject iptv(String kind, String source, String category, String q, int page, String language) {
        HttpUrl base = HttpUrl.parse(abs("/api/app/iptv"));
        if (base == null) return err("bad_url");
        return getUrl(base.newBuilder()
                .addQueryParameter("kind", kind)
                .addQueryParameter("source", source == null ? "all" : source)
                .addQueryParameter("category", category == null ? "" : category)
                .addQueryParameter("language", language == null ? "All" : language)
                .addQueryParameter("q", q == null ? "" : q)
                .addQueryParameter("page", String.valueOf(page))
                .build());
    }
    public static JSONObject iptvSeries(String id) {
        HttpUrl base = HttpUrl.parse(abs("/api/app/iptv/series"));
        if (base == null) return err("bad_url");
        return getUrl(base.newBuilder().addQueryParameter("id", id).build());
    }
    public static JSONObject login(String user, String pass, String totpCode, String totpCred) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("username", user);
        fields.put("login_id", user);
        fields.put("password", pass);
        if (totpCode != null && !totpCode.isEmpty()) fields.put("totp_code", totpCode);
        if (totpCred != null && !totpCred.isEmpty()) fields.put("totp_cred", totpCred);
        return postForm("/api/app/login", fields);
    }
    public static JSONObject logout() { return postForm("/api/app/logout", java.util.Collections.emptyMap()); }
    public static JSONObject catalog(String kind, int page) {
        return catalog(kind, page, "popular");
    }
    public static JSONObject catalog(String kind, int page, String category) {
        HttpUrl base = HttpUrl.parse(abs("/api/app/catalog/" + kind));
        if (base == null) return err("bad_url");
        return getUrl(base.newBuilder()
                .addQueryParameter("page", String.valueOf(page))
                .addQueryParameter("category", category == null || category.isEmpty() ? "popular" : category)
                .build());
    }
    public static JSONObject filter(String type, String genre, int page) {
        HttpUrl base = HttpUrl.parse(abs("/api/app/filter"));
        if (base == null) return err("bad_url");
        String mt = type == null ? "movie" : type;
        if ("anime".equals(mt)) mt = "tv";
        return getUrl(base.newBuilder()
                .addQueryParameter("type", mt)
                .addQueryParameter("genre", genre == null ? "" : genre)
                .addQueryParameter("page", String.valueOf(Math.max(1, page)))
                .build());
    }
    public static JSONObject setProfilePin(long id, String pin) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("id", String.valueOf(id));
        fields.put("profile_id", String.valueOf(id));
        fields.put("pin", pin == null ? "" : pin);
        return postForm("/api/app/profile/pin", fields);
    }
    public static JSONObject setPlayback(boolean autoplay) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        if (autoplay) fields.put("autoplay_next", "1");
        return postForm("/api/app/profile/playback", fields);
    }
    public static JSONObject trailer(String type, long id) {
        return get("/api/app/trailer/" + type + "/" + id);
    }
    public static JSONObject downloadOptions(String type, long id, int s, int e) {
        JSONObject json = get("/api/app/downloads/" + type + "/" + id + "?s=" + s + "&e=" + e);
        if (hasDownloads(json)) return json;
        try {
            JSONObject watch = get("/api/app/watch/" + type + "/" + id + "?s=" + s + "&e=" + e);
            if (hasDownloads(watch)) return watch;
        } catch (Exception ignored) {}
        JSONObject scraped = scrapeWatchDownloads(type, id, s, e);
        if (hasDownloads(scraped)) return scraped;
        return json == null ? err("no_source") : json;
    }

    private static boolean hasDownloads(JSONObject json) {
        if (json == null) return false;
        JSONArray arr = json.optJSONArray("downloads");
        return arr != null && arr.length() > 0;
    }

    private static JSONObject scrapeWatchDownloads(String type, long id, int s, int e) {
        String mt = ("tv".equals(type) || "anime".equals(type) || "series".equals(type)) ? "tv" : "movie";
        String path = "/watch/" + mt + "/" + id + "?s=" + Math.max(1, s) + "&e=" + Math.max(1, e);
        try {
            Request req = new Request.Builder()
                    .url(abs(path))
                    .header("Accept", "text/html,application/xhtml+xml")
                    .header("User-Agent", EMBED_UA)
                    .get()
                    .build();
            String html;
            try (Response res = client().newCall(req).execute()) {
                html = res.body() != null ? res.body().string() : "";
            }
            if (html == null || html.isEmpty()) return err("no_source");
            int mark = html.toLowerCase().indexOf("download options");
            String slice = mark >= 0 ? html.substring(mark, Math.min(html.length(), mark + 8000)) : html;
            JSONArray arr = new JSONArray();
            Pattern p = Pattern.compile(
                    "href=\"(/download/[a-fA-F0-9]{64}|https?://[^\"]+)\"[^>]*>\\s*(?:<i[^>]*fa-download[^<]*</i>\\s*)?([^<]+)",
                    Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
            Matcher m = p.matcher(slice);
            while (m.find()) {
                String href = m.group(1);
                String name = m.group(2) == null ? "Download" : m.group(2).trim();
                if (href == null || href.isEmpty()) continue;
                if (href.contains("/watch/") || href.contains("/api/secure_play")) continue;
                JSONObject o = new JSONObject();
                String token = "";
                int slash = href.lastIndexOf('/');
                if (href.contains("/download/") && slash >= 0) {
                    String t = href.substring(slash + 1);
                    if (t.matches("[a-fA-F0-9]{64}")) token = t;
                }
                o.put("name", name.isEmpty() ? "Download" : name);
                o.put("token", token);
                o.put("href", href);
                o.put("play", token.isEmpty() ? href : "/download-frame/" + token);
                o.put("url", href.startsWith("http") ? href : href);
                arr.put(o);
            }
            if (arr.length() == 0) {
                Pattern p2 = Pattern.compile("href=\"(/download/[a-fA-F0-9]{64})\"");
                Matcher m2 = p2.matcher(html);
                while (m2.find()) {
                    String href = m2.group(1);
                    String token = href.substring(href.lastIndexOf('/') + 1);
                    JSONObject o = new JSONObject();
                    o.put("name", "Download");
                    o.put("token", token);
                    o.put("href", href);
                    o.put("play", "/download-frame/" + token);
                    o.put("url", href);
                    arr.put(o);
                }
            }
            return new JSONObject().put("ok", true).put("downloads", arr);
        } catch (Exception e2) {
            return err("no_source");
        }
    }
    public static JSONObject personCredits(long id, int page) {
        HttpUrl base = HttpUrl.parse(abs("/api/app/person/" + id + "/credits"));
        if (base == null) return err("bad_url");
        return getUrl(base.newBuilder().addQueryParameter("page", String.valueOf(Math.max(1, page))).build());
    }
    public static JSONObject addReview(String type, long id, int rating, String text) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("type", type == null ? "movie" : type);
        fields.put("media_type", type == null ? "movie" : type);
        fields.put("id", String.valueOf(id));
        fields.put("tmdb_id", String.valueOf(id));
        fields.put("rating", String.valueOf(rating));
        fields.put("review_text", text == null ? "" : text);
        return postForm("/api/app/review", fields);
    }
    public static JSONObject submitRequest(String kind, String title, String message) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("request_type", kind == null || kind.isEmpty() ? "movie" : kind);
        fields.put("title", title == null ? "" : title);
        fields.put("message", message == null ? "" : message);
        return postForm("/api/app/request", fields);
    }
    public static JSONObject totpSetup(String password) {
        java.util.HashMap<String,String> fields=new java.util.HashMap<>();
        fields.put("confirm_password",password == null ? "" : password);
        return postForm("/api/app/totp/setup",fields);
    }
    public static JSONObject totpVerify(String code) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("code", code == null ? "" : code);
        fields.put("totp_code", code == null ? "" : code);
        return postForm("/api/app/totp/verify", fields);
    }
    public static JSONObject totpDisable(String password) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("password", password == null ? "" : password);
        fields.put("confirm_password", password == null ? "" : password);
        return postForm("/api/app/totp/disable", fields);
    }
    public static JSONObject partyJoin(String username, String room) {
        JSONObject b = new JSONObject();
        try {
            b.put("username", username == null ? "Guest" : username);
            b.put("room", room == null ? "" : room);
        } catch (Exception ignored) {}
        return postJson("/api/party/join", b);
    }
    public static JSONObject partySend(String username, String room, String msg) {
        JSONObject b = new JSONObject();
        try {
            b.put("username", username == null ? "Guest" : username);
            b.put("room", room == null ? "" : room);
            b.put("msg", msg == null ? "" : msg);
        } catch (Exception ignored) {}
        return postJson("/api/party/send", b);
    }
    public static JSONObject partyMessages(String room, long since) {
        HttpUrl base = HttpUrl.parse(abs("/api/party/messages"));
        if (base == null) return err("bad_url");
        return getUrl(base.newBuilder()
                .addQueryParameter("room", room == null ? "" : room)
                .addQueryParameter("since", String.valueOf(since))
                .build());
    }
    public static JSONObject watchlist() { return get("/api/app/watchlist"); }
    public static JSONObject watchlistToggle(String type, long id) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("type", type);
        fields.put("id", String.valueOf(id));
        return postForm("/api/app/watchlist/toggle", fields);
    }
    public static JSONObject register(String username, String email, String password, String confirm) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("username", username);
        fields.put("email", email);
        fields.put("password", password);
        fields.put("confirm", confirm);
        fields.put("confirm_password", confirm);
        return postForm("/api/app/register", fields);
    }
    public static JSONObject info() { return get("/api/app/info"); }
    public static JSONObject page(String kind) {
        return page(kind, 1);
    }
    public static JSONObject page(String kind, int page) {
        HttpUrl base = HttpUrl.parse(abs("/api/app/page/" + kind));
        if (base == null) return err("bad_url");
        return getUrl(base.newBuilder().addQueryParameter("page", String.valueOf(Math.max(1, page))).build());
    }
    public static JSONObject page(String kind, String id) {
        if (id == null || id.isEmpty()) return page(kind, 1);
        return get("/api/app/page/" + kind + "/" + id);
    }
    public static JSONObject pageQuery(String kind, String q) {
        HttpUrl base = HttpUrl.parse(abs("/api/app/page/" + kind));
        if (base == null) return err("bad_url");
        return getUrl(base.newBuilder().addQueryParameter("q", q == null ? "" : q).build());
    }
    public static JSONObject pagePost(String kind, Map<String, String> fields) {
        return postForm("/api/app/page/" + kind, fields);
    }
    public static JSONObject profiles() { return get("/api/app/profiles"); }
    public static JSONObject selectProfile(long id, String pin) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("id", String.valueOf(id));
        if (pin != null && !pin.isEmpty()) fields.put("pin", pin);
        return postForm("/api/app/profile/select", fields);
    }
    public static JSONObject addProfile(String name, boolean kids, String color) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        String n = name == null ? "" : name;
        fields.put("name", n);
        fields.put("profile_name", n);
        if (kids) fields.put("is_kids", "1");
        fields.put("avatar_color", color == null || color.isEmpty() ? "bg-red-600" : color);
        return postForm("/api/app/profile/add", fields);
    }
    public static JSONObject deleteProfile(long id) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("id", String.valueOf(id));
        fields.put("profile_id", String.valueOf(id));
        return postForm("/api/app/profile/delete", fields);
    }

    private static String cleanPath(String path) {
        if (path == null) return "";
        String s = path.trim();
        if (s.isEmpty() || "null".equalsIgnoreCase(s) || "undefined".equalsIgnoreCase(s)) return "";
        return s;
    }

    public static List<MediaItem> parseItems(JSONArray arr) {
        List<MediaItem> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null) out.add(parseItem(o));
        }
        return out;
    }

    public static MediaItem parseItem(JSONObject o) {
        MediaItem m = new MediaItem();
        m.id = o.optLong("id");
        m.media_type = o.optString("media_type", "movie");
        m.title = o.optString("title");
        if (m.title.isEmpty() || "null".equalsIgnoreCase(m.title)) m.title = o.optString("name");
        if ("null".equalsIgnoreCase(m.title)) m.title = "";
        m.poster_path = cleanPath(o.optString("poster_path"));
        m.backdrop_path = cleanPath(o.optString("backdrop_path"));
        if (m.poster_path.isEmpty()) m.poster_path = cleanPath(o.optString("profile_path"));
        m.vote_average = o.optDouble("vote_average", 0);
        m.year = o.optString("year");
        if ("null".equalsIgnoreCase(m.year)) m.year = "";
        m.overview = o.optString("overview");
        m.runtime = o.optInt("runtime");
        m.tagline = o.optString("tagline");
        m.logo_path = cleanPath(o.optString("logo_path"));
        if (m.id > 0 && m.logo_path != null && !m.logo_path.isEmpty()) rememberLogo(m.media_type, m.id, m.logo_path);
        JSONArray g = o.optJSONArray("genres");
        if (g != null) for (int i = 0; i < g.length(); i++) m.genres.add(g.optString(i));
        m.original_language = o.optString("original_language");
        if ("null".equalsIgnoreCase(m.original_language)) m.original_language = "";
        m.is_anime = o.optBoolean("is_anime", false);
        JSONArray ids = o.optJSONArray("genre_ids");
        if (ids != null && ids.length() > 0) {
            int n = Math.min(ids.length(), 8);
            m.genre_ids = new int[n];
            for (int i = 0; i < n; i++) m.genre_ids[i] = ids.optInt(i);
        }
        if (!m.is_anime && "ja".equalsIgnoreCase(m.original_language) && m.genre_ids != null) {
            for (int id : m.genre_ids) if (id == 16) { m.is_anime = true; break; }
        }
        if (!m.is_anime && "anime".equalsIgnoreCase(m.media_type)) m.is_anime = true;
        return m;
    }

    public static AppUser parseUser(JSONObject o) {
        if (o == null) return null;
        AppUser u = new AppUser();
        u.id = o.optLong("id");
        u.username = o.optString("username");
        u.role = o.optString("role", "user");
        u.is_kids = o.optBoolean("is_kids", false);
        u.profile_id = o.optLong("profile_id");
        u.profile_name = o.optString("profile_name");
        u.autoplay_next = o.optBoolean("autoplay_next", true);
        u.totp_enabled = o.optBoolean("totp_enabled", false);
        u.emailMasked = o.optString("email_masked", "");
        in.cineamit.app.OfflinePolicy.record(u);
        return u;
    }

    public static List<UserProfile> parseProfiles(JSONArray arr) {
        List<UserProfile> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            UserProfile p = new UserProfile();
            p.id = o.optLong("id");
            p.name = o.optString("name");
            p.is_kids = o.optBoolean("is_kids", false);
            p.has_pin = o.optBoolean("has_pin", false);
            p.color = o.optString("color");
            out.add(p);
        }
        return out;
    }

    public static List<HomeRow> parseRows(JSONArray arr) {
        List<HomeRow> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            HomeRow r = new HomeRow();
            r.id = o.optString("id");
            r.title = o.optString("title");
            r.browse = o.optString("browse");
            r.items = parseItems(o.optJSONArray("items"));
            out.add(r);
        }
        return out;
    }

    public static List<Studio> parseStudios(JSONArray arr) {
        List<Studio> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            Studio s = new Studio();
            s.id = o.optLong("id");
            s.name = o.optString("name");
            s.thumbnail_url = o.optString("thumbnail_url");
            out.add(s);
        }
        return out;
    }

    public static List<Provider> parseProviders(JSONArray arr) {
        List<Provider> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            Provider p = new Provider();
            p.provider_id = o.optLong("provider_id");
            p.provider_name = o.optString("provider_name");
            p.logo_path = o.optString("logo_path");
            out.add(p);
        }
        return out;
    }

    public static List<Server> parseServers(JSONArray arr) {
        List<Server> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            String play = o.optString("play");
            if (play.isEmpty()) continue;
            Server s = new Server();
            s.name = o.optString("name", "Server");
            s.play = play;
            s.vip = o.optBoolean("vip", false) || AdBlock.isVipServer(s.name);
            out.add(s);
        }
        return out;
    }

    public static List<Season> parseSeasons(JSONArray arr) {
        List<Season> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            Season s = new Season();
            s.season_number = o.optInt("season_number");
            s.name = o.optString("name");
            s.episode_count = o.optInt("episode_count");
            s.poster_path = o.optString("poster_path");
            out.add(s);
        }
        return out;
    }

    public static List<Episode> parseEpisodes(JSONArray arr) {
        List<Episode> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            Episode e = new Episode();
            e.episode_number = o.optInt("episode_number");
            e.name = o.optString("name");
            e.overview = o.optString("overview");
            e.still_path = cleanPath(o.optString("still_path"));
            e.runtime = o.optInt("runtime");
            out.add(e);
        }
        return out;
    }

    public static List<CastPerson> parseCast(JSONArray arr) {
        List<CastPerson> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            CastPerson c = new CastPerson();
            c.id = o.optLong("id");
            c.name = o.optString("name");
            c.character = o.optString("character");
            c.profile_path = o.optString("profile_path");
            out.add(c);
        }
        return out;
    }

    public static List<VodItem> parseVodItems(JSONArray arr) {
        List<VodItem> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            VodItem v = new VodItem();
            v.id = o.optString("id");
            v.name = o.optString("name");
            v.logo = o.optString("logo");
            v.category = o.optString("category");
            v.year = o.optString("year");
            v.kind = o.optString("kind", "movie");
            v.source = o.optString("source");
            v.language = o.optString("language");
            v.has_episodes = o.optBoolean("has_episodes", false);
            v.play = o.optString("play");
            out.add(v);
        }
        return out;
    }

    public static List<VodSeason> parseVodSeasons(JSONArray arr) {
        List<VodSeason> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            VodSeason s = new VodSeason();
            s.season_number = o.optInt("season_number");
            s.name = o.optString("name");
            JSONArray eps = o.optJSONArray("episodes");
            if (eps != null) {
                for (int j = 0; j < eps.length(); j++) {
                    JSONObject e = eps.optJSONObject(j);
                    if (e == null) continue;
                    VodEpisode ep = new VodEpisode();
                    ep.episode_number = e.optInt("episode_number");
                    ep.name = e.optString("name");
                    ep.play = e.optString("play");
                    ep.still = e.optString("still");
                    s.episodes.add(ep);
                }
            }
            out.add(s);
        }
        return out;
    }

    public static List<LiveChannel> parseLive(JSONObject json) {
        List<LiveChannel> out = parseLive(liveArray(json));
        if (!out.isEmpty() || json == null) return out;
        String raw = json.optString("channels_json");
        if (raw != null && raw.trim().startsWith("[")) {
            try { return parseLive(new JSONArray(raw)); } catch (Exception ignored) {}
        }
        return out;
    }

    public static List<LiveChannel> parseLive(JSONArray arr) {
        List<LiveChannel> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            LiveChannel c = oneLive(arr.optJSONObject(i));
            if (c != null) out.add(c);
        }
        return out;
    }

    private static String firstNonEmpty(JSONObject o, String... keys) {
        for (String k : keys) {
            String v = o.optString(k, "").trim();
            if (!v.isEmpty() && !"null".equalsIgnoreCase(v)) return v;
        }
        return "";
    }

    public static List<String> stringList(JSONArray arr) {
        List<String> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            String s = arr.optString(i);
            if (s != null && !s.isEmpty()) out.add(s);
        }
        return out;
    }

    public static void applyMeta(JSONObject json) {
        if (json == null || (json.has("ok") && !json.optBoolean("ok"))) return;
        String ib = json.optString("image_base");
        if (ib != null && !ib.isEmpty()) {
            while (ib.endsWith("/")) ib = ib.substring(0, ib.length() - 1);
            Session.imageBase = ib;
        }
        String site = json.optString("site");
        if (site != null && !site.isEmpty()) Session.site = site;
        if (json.has("user")) Session.user = parseUser(json.optJSONObject("user"));
        in.cineamit.app.Sub.applyRemote(json);
        boolean gaOn = json.optBoolean("ga_enabled", false);
        JSONObject ga = json.optJSONObject("ga");
        if (ga != null) gaOn = ga.optBoolean("enabled", gaOn);
        in.cineamit.app.Analytics.setEnabled(gaOn);
        if (json.optBoolean("ok", false) && json.has("user") && json.optJSONObject("economy") != null)
            in.cineamit.app.Ads.onMetadataReady();
    }

    public static JSONObject ga(JSONObject body) {
        return postJson("/api/app/ga", body == null ? new JSONObject() : body);
    }

    public static JSONObject walletSync(JSONObject body) {
        return postJson("/api/app/wallet/sync", body == null ? new JSONObject() : body);
    }

    public static JSONObject adDiagnostics(JSONObject body) {
        return postJson("/api/app/ads/diagnostics", body);
    }

    public static JSONObject walletTicket(String adUnit) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("ad_unit", adUnit);
        return postForm("/api/app/wallet/ticket", fields);
    }

    public static JSONObject walletRewardStatus(String ticket) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("ticket", ticket);
        return postForm("/api/app/wallet/reward-status", fields);
    }

    public static JSONObject walletEarn(String ticket) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("ticket", ticket == null ? "" : ticket);
        return postForm("/api/app/wallet/earn", fields);
    }

    public static JSONObject walletRedeem(String type) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("type", type == null ? "" : type);
        return postForm("/api/app/wallet/redeem", fields);
    }

    public static JSONObject walletTrial() {
        return postForm("/api/app/wallet/trial", java.util.Collections.emptyMap());
    }

    public static JSONObject walletCancel() {
        return postForm("/api/app/wallet/cancel", java.util.Collections.emptyMap());
    }

    public static JSONObject dlPinOtp() {
        return postForm("/api/app/dlpin/otp", java.util.Collections.emptyMap());
    }

    public static JSONObject dlPinVerify(String otp) {
        java.util.HashMap<String, String> fields = new java.util.HashMap<>();
        fields.put("otp", otp == null ? "" : otp);
        return postForm("/api/app/dlpin/verify", fields);
    }
}
