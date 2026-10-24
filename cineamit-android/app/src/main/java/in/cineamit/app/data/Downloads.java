package in.cineamit.app.data;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import in.cineamit.app.CineAmitApp;
import in.cineamit.app.AccessGate;
import in.cineamit.app.DownloadCatch;
import in.cineamit.app.DownloadService;
import in.cineamit.app.DownloadWebActivity;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Hotstar-style local download shelf. Real video file only; HTML/HLS = failed + retry. */
public final class Downloads {
    public static final String Q_SAVER = "saver";
    public static final String Q_HIGH = "high";
    public static final String Q_BEST = "best";
    public static final long EXPIRE_MS = 30L * 24 * 60 * 60 * 1000;
    private static final long MIN_FILE = 8L * 1024;
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    public static final String ST_QUEUED = "queued";
    public static final String ST_RUN = "running";
    public static final String ST_ACCESS = "access";
    public static final String ST_WIFI = "wifi";
    public static final String ST_DONE = "done";
    public static final String ST_FAIL = "failed";

    public interface Listener {
        void onDownloads();
    }

    public static final class Item {
        public String key = "";
        public String type = "movie";
        public long id;
        public int s = 1;
        public int e = 1;
        public String title = "";
        public String poster = "";
        public String quality = Q_HIGH;
        public String status = ST_QUEUED;
        public String path = "";
        public String token = "";
        public String sourceUrl = "";
        public String serverName = "";
        public String error = "";
        public long bytes;
        public long total;
        public long created;
        public long expires;
        public int progress;
        public String folder = "";
        public boolean priv;
        public boolean kidsSafe;
        public boolean toGallery;
        public String galleryUri = "";
        public transient boolean cancel;
        public transient boolean working;
    }

    public static final String FOLDER_MOVIES = "Movies";
    public static final String FOLDER_SERIES = "Series";
    public static final String FOLDER_ANIME = "Anime";
    public static final String FOLDER_PRIVATE = "Private";

    public static String defaultFolder(String type) {
        if ("anime".equals(type)) return FOLDER_ANIME;
        if ("tv".equals(type) || "series".equals(type)) return FOLDER_SERIES;
        return FOLDER_MOVIES;
    }

    public static synchronized List<String> folders() {
        load();
        java.util.LinkedHashSet<String> set = new java.util.LinkedHashSet<>();
        set.add(FOLDER_MOVIES);
        set.add(FOLDER_SERIES);
        set.add(FOLDER_ANIME);
        try {
            JSONArray extra = new JSONArray(CineAmitApp.prefs().getString("dl_folders", "[]"));
            for (int i = 0; i < extra.length(); i++) {
                String n = extra.optString(i).trim();
                if (!n.isEmpty() && !FOLDER_PRIVATE.equalsIgnoreCase(n) && !"All".equalsIgnoreCase(n)) set.add(n);
            }
        } catch (Exception ignored) {}
        for (Item it : ITEMS) {
            if (!in.cineamit.app.OfflinePolicy.allows(it.kidsSafe)) continue;
            if (it.priv) continue;
            if (it.folder != null && !it.folder.trim().isEmpty()
                    && !FOLDER_PRIVATE.equalsIgnoreCase(it.folder.trim())) {
                set.add(it.folder.trim());
            }
        }
        return new ArrayList<>(set);
    }

    public static synchronized void addFolder(String name) {
        name = cleanFolder(name);
        if (name.isEmpty()) return;
        List<String> have = folders();
        if (have.contains(name)) return;
        try {
            JSONArray extra = new JSONArray(CineAmitApp.prefs().getString("dl_folders", "[]"));
            extra.put(name);
            CineAmitApp.prefs().edit().putString("dl_folders", extra.toString()).apply();
        } catch (Exception ignored) {}
        fire();
    }

    public static synchronized void setFolder(Item item, String folder) {
        if (item == null) return;
        if (folder != null && FOLDER_PRIVATE.equalsIgnoreCase(folder.trim())) {
            item.priv = true;
            persist();
            fire();
            return;
        }
        item.priv = false;
        item.folder = cleanFolder(folder);
        if (item.folder.isEmpty()) item.folder = defaultFolder(item.type);
        persist();
        fire();
    }

    public static synchronized void setPrivate(Item item, boolean on) {
        if (item == null) return;
        item.priv = on;
        if (on) item.toGallery = false;
        persist();
        fire();
    }

    public static synchronized void deletePrivate() {
        load();
        List<Item> drop = new ArrayList<>();
        synchronized (Downloads.class) {
            for (Item it : ITEMS) if (it.priv) drop.add(it);
        }
        for (Item it : drop) delete(it);
    }

    public static synchronized List<Item> inFolder(String folder) {
        load();
        pruneExpired();
        List<Item> out = new ArrayList<>();
        boolean privFolder = folder != null && FOLDER_PRIVATE.equalsIgnoreCase(folder);
        boolean all = folder == null || folder.isEmpty() || "All".equalsIgnoreCase(folder);
        if (privFolder && !DlVault.unlocked()) return out;
        for (Item it : ITEMS) {
            if (!in.cineamit.app.OfflinePolicy.allows(it.kidsSafe)) continue;
            boolean hidden = it.priv || (it.folder != null && FOLDER_PRIVATE.equalsIgnoreCase(it.folder.trim()));
            if (privFolder) {
                if (hidden) out.add(it);
                continue;
            }
            if (hidden) continue;
            if (all) {
                out.add(it);
                continue;
            }
            String f = (it.folder == null || it.folder.isEmpty()) ? defaultFolder(it.type) : it.folder;
            if (folder.equals(f)) out.add(it);
        }
        return out;
    }

    private static String cleanFolder(String name) {
        if (name == null) return "";
        name = name.trim().replaceAll("\\s+", " ");
        if (FOLDER_PRIVATE.equalsIgnoreCase(name) || "All".equalsIgnoreCase(name)) return "";
        if (name.length() > 24) name = name.substring(0, 24).trim();
        return name;
    }

    private static final ExecutorService POOL = Executors.newFixedThreadPool(2);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final CopyOnWriteArrayList<Listener> LISTENERS = new CopyOnWriteArrayList<>();
    private static final List<Item> ITEMS = new ArrayList<>();
    private static boolean loaded;
    private static OkHttpClient dlHttp;

    private Downloads() {}

    public static void init() {
        load();
    }

    /** Call from an Activity resume — never from Application.onCreate (FGS rules). */
    public static void resumeQueue() {
        if (AccessGate.blocked()) return;
        load();
        for (Item item : all()) if (ST_ACCESS.equals(item.status) && !item.working) { item.status = ST_QUEUED; kick(item); }
        retryWifi();
    }

    public static void listen(Listener l) {
        if (l != null && !LISTENERS.contains(l)) LISTENERS.add(l);
    }

    public static void unlisten(Listener l) {
        LISTENERS.remove(l);
    }

    public static synchronized List<Item> all() {
        load();
        pruneExpired();
        List<Item> visible=new ArrayList<>();
        for (Item item:ITEMS) if (in.cineamit.app.OfflinePolicy.allows(item.kidsSafe)) visible.add(item);
        return visible;
    }

    public static synchronized Item find(String type, long id, int s, int e) {
        load();
        String k = key(type, id, s, e);
        for (Item it : ITEMS) if (k.equals(it.key)) return it;
        return null;
    }

    public static synchronized boolean busy() {
        load();
        for (Item it : ITEMS) {
            if (ST_RUN.equals(it.status) || ST_QUEUED.equals(it.status)) return true;
        }
        return false;
    }

    public static synchronized Item current() {
        load();
        Item queued = null;
        for (Item it : ITEMS) {
            if (ST_RUN.equals(it.status)) return it;
            if (queued == null && ST_QUEUED.equals(it.status)) queued = it;
        }
        return queued;
    }

    public static String key(String type, long id, int s, int e) {
        return (type == null ? "movie" : type) + ":" + id + ":" + s + ":" + e;
    }

    public static synchronized long bytesUsed() {
        load();
        long n = 0;
        File dir = dir();
        File[] files = dir == null ? null : dir.listFiles();
        if (files != null) for (File f : files) n += f.length();
        return n;
    }

    public static String prettySize(long n) {
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return (n / 1024) + " KB";
        if (n < 1024L * 1024 * 1024) return String.format(java.util.Locale.US, "%.1f MB", n / (1024f * 1024f));
        return String.format(java.util.Locale.US, "%.2f GB", n / (1024f * 1024f * 1024f));
    }

    public static String errLabel(Item it) {
        if (it == null || it.error == null) return "Failed";
        switch (it.error) {
            case "no_file": return "No video file";
            case "no_source": return "No download source";
            case "hls": return "HLS — stream only";
            case "kids": return "Kids restricted";
            case "login": return "Login required";
            case "wifi": return "Waiting for Wi‑Fi";
            case "access": return "Disable VPN / filtering DNS";
            case "Cancelled": return "Cancelled";
            default:
                if (it.error.startsWith("http_")) return "Link failed";
                return "Failed";
        }
    }

    public static void enqueue(Item seed, String token) {
        if (seed == null || seed.id <= 0) return;
        load();
        seed.key = key(seed.type, seed.id, seed.s, seed.e);
        seed.created = System.currentTimeMillis();
        seed.expires = seed.created + EXPIRE_MS;
        seed.token = token == null ? "" : token;
        seed.cancel = false;
        seed.working = false;
        seed.progress = 0;
        seed.bytes = 0;
        seed.total = 0;
        seed.path = "";
        seed.error = "";
        if (seed.folder == null || seed.folder.trim().isEmpty()) seed.folder = defaultFolder(seed.type);
        else seed.folder = cleanFolder(seed.folder);
        if (seed.priv) seed.toGallery = false;
        if (seed.galleryUri == null) seed.galleryUri = "";
        if (Q_SAVER.equals(seed.quality) && !onWifi()) seed.status = ST_WIFI;
        else seed.status = ST_QUEUED;
        synchronized (Downloads.class) {
            Iterator<Item> it = ITEMS.iterator();
            while (it.hasNext()) {
                Item old = it.next();
                if (seed.key.equals(old.key)) {
                    old.cancel = true;
                    wipeFiles(old);
                    it.remove();
                }
            }
            ITEMS.add(0, seed);
            persist();
        }
        fire();
        if (!ST_WIFI.equals(seed.status)) kick(seed);
    }

    public static void retry(Item item) {
        if (item == null) return;
        Item seed = new Item();
        seed.type = item.type;
        seed.id = item.id;
        seed.s = item.s;
        seed.e = item.e;
        seed.title = item.title;
        seed.poster = item.poster;
        seed.quality = item.quality;
        seed.folder = item.folder;
        seed.priv = item.priv;
        seed.toGallery = item.toGallery;
        enqueue(seed, "");
    }

    public static void retryWifi() {
        load();
        List<Item> wait = new ArrayList<>();
        synchronized (Downloads.class) {
            for (Item it : ITEMS) if (ST_WIFI.equals(it.status) && !it.working) wait.add(it);
        }
        if (wait.isEmpty() || !onWifi()) return;
        for (Item it : wait) {
            it.status = ST_QUEUED;
            it.error = "";
            persist();
            fire();
            kick(it);
        }
    }

    public static void cancel(Item item) {
        if (item == null) return;
        item.cancel = true;
        if (ST_RUN.equals(item.status) || ST_QUEUED.equals(item.status) || ST_WIFI.equals(item.status)) {
            item.status = ST_FAIL;
            item.error = "Cancelled";
            persist();
            fire();
        }
    }

    public static void delete(Item item) {
        if (item == null) return;
        item.cancel = true;
        wipeFiles(item);
        synchronized (Downloads.class) {
            ITEMS.remove(item);
            persist();
        }
        fire();
    }

    public static File artFile(Item item) {
        return new File(dir(), safe(item.key) + ".jpg");
    }

    public static boolean canPlayOffline(Item item) {
        if (item == null || item.path == null || item.path.isEmpty() || (item.expires>0 && item.expires<=System.currentTimeMillis())
                || !in.cineamit.app.OfflinePolicy.allows(item.kidsSafe)) return false;
        File f = new File(item.path);
        return f.isFile() && f.length() >= MIN_FILE;
    }

    public static synchronized boolean localPlaybackAllowed(String url) {
        return localAdmission(url,true);
    }
    /** An already admitted player keeps only its file-specific private grant.
     * Kids eligibility, index membership and expiry remain live checks. */
    public static synchronized boolean localPlaybackStillAllowed(String url) {
        return localAdmission(url,false);
    }
    private static boolean localAdmission(String url,boolean requireVault) {
        load();
        try {
            File target=new File(url.startsWith("file:") ? new java.net.URI(url) : new File(url).toURI()).getCanonicalFile();
            for (Item item:ITEMS) if (item.path!=null && !item.path.isEmpty() && new File(item.path).getCanonicalFile().equals(target))
                return canPlayOffline(item) && (!requireVault || !(item.priv || FOLDER_PRIVATE.equalsIgnoreCase(item.folder)) || DlVault.unlocked());
        } catch (Exception invalid) {}
        return false;
    }

    public static boolean inGallery(Item item) {
        return item != null && item.galleryUri != null && !item.galleryUri.isEmpty();
    }

    /** Copy a finished file into the phone Gallery. Returns a message. */
    public static String saveToGallery(Item item) {
        if (item == null) return "File not found";
        if (!canPlayOffline(item)) return "Wait for the download to finish";
        if (inGallery(item)) return "Already in Gallery";
        try {
            String uri = GallerySave.putVideo(item);
            if (uri == null || uri.isEmpty()) return "Gallery save fail";
            item.galleryUri = uri;
            persist();
            fire();
            return "Saved to Gallery";
        } catch (Exception e) {
            return e.getMessage() == null ? "Gallery save fail" : e.getMessage();
        }
    }

    private static void exportGallery(Item item) {
        if (item == null || item.priv || !item.toGallery) return;
        if (inGallery(item) || !canPlayOffline(item)) return;
        try {
            String uri = GallerySave.putVideo(item);
            if (uri != null && !uri.isEmpty()) item.galleryUri = uri;
        } catch (Exception ignored) {}
    }

    private static void pauseAccess(Item item) { item.status = ST_ACCESS; item.error = "Disable VPN / filtering DNS"; persist(); fire(); }

    private static void kick(Item item) {
        if (item == null) return;
        if (AccessGate.blocked()) { pauseAccess(item); return; }
        try { DownloadService.ensure(); } catch (Exception ignored) {}
        android.app.Activity a = CineAmitApp.foreground();
        if (a != null && !(a instanceof DownloadWebActivity)
                && !(a instanceof in.cineamit.app.SplashActivity)
                && !(a instanceof in.cineamit.app.PlayerActivity)) {
            item.status = ST_RUN;
            persist();
            fire();
            MAIN.post(() -> DownloadWebActivity.open(a, item.key));
            return;
        }
        POOL.execute(() -> run(item));
    }

    public static Item byKey(String key) {
        if (key == null || key.isEmpty()) return null;
        load();
        synchronized (Downloads.class) {
            for (Item it : ITEMS) if (key.equals(it.key)) return it;
        }
        return null;
    }

    public static boolean prepareToken(Item item) {
        return item != null && refreshToken(item);
    }

    public static boolean pullFile(Item item, String url, String referer, String ua) throws Exception {
        if (item == null) return false;
        if (AccessGate.blocked()) { pauseAccess(item); return false; }
        item.working = true;
        item.status = ST_RUN;
        item.error = "";
        persist();
        fire();
        try {
            boolean ok = copyUrl(item, url, referer, ua);
            if (ok && canPlayOffline(item)) {
                item.status = ST_DONE;
                item.error = "";
                item.progress = 100;
                exportGallery(item);
                return true;
            }
            fail(item, item.error == null || item.error.isEmpty() ? "no_file" : item.error);
            return false;
        } catch (AccessGate.Restricted restricted) {
            pauseAccess(item); return false;
        } finally {
            item.working = false;
            persist();
            fire();
        }
    }

    private static void run(Item item) {
        if (AccessGate.blocked()) { pauseAccess(item); return; }
        synchronized (Downloads.class) {
            if (item.cancel || item.working) return;
            if (!ITEMS.contains(item)) return;
            item.working = true;
            item.status = ST_RUN;
            persist();
        }
        fire();
        try {
            savePoster(item);
            if (item.cancel || !listed(item)) return;
            if (!refreshToken(item)) {
                if (AccessGate.cachedBlocked()) { pauseAccess(item); return; }
                fail(item, item.error == null || item.error.isEmpty() ? "no_source" : item.error);
                return;
            }
            boolean ok = saveVideo(item);
            if (item.cancel || !listed(item)) return;
            if (!ok && ("http_410".equals(item.error) || "http_404".equals(item.error))) {
                if (refreshToken(item)) ok = saveVideo(item);
            }
            if (item.cancel || !listed(item)) return;
            if (ok && canPlayOffline(item)) {
                item.status = ST_DONE;
                item.error = "";
                item.progress = 100;
                exportGallery(item);
            } else if (!ST_FAIL.equals(item.status)) {
                fail(item, item.error == null || item.error.isEmpty() ? "no_file" : item.error);
            }
        } catch (Exception e) {
            if (!item.cancel && listed(item)) {
                if (e instanceof AccessGate.Restricted || AccessGate.cachedBlocked()) pauseAccess(item);
                else fail(item, e.getMessage() == null ? "fail" : e.getMessage());
            }
        } finally {
            item.working = false;
            if (listed(item)) persist();
            fire();
        }
    }

    private static void fail(Item item, String why) {
        item.status = ST_FAIL;
        item.error = why == null ? "fail" : why;
        item.progress = 0;
    }

    private static boolean listed(Item item) {
        synchronized (Downloads.class) { return ITEMS.contains(item); }
    }

    private static boolean refreshToken(Item item) {
        try {
            JSONObject json = Api.downloadOptions(item.type, item.id, item.s, item.e);
            if (json == null || !json.optBoolean("ok")) {
                String err = json == null ? "fail" : json.optString("error", "fail");
                if ("kids_restricted".equals(err)) item.error = "kids";
                else if ("login_required".equals(err)) item.error = "login";
                else item.error = err;
                return false;
            }
            item.kidsSafe=json.optBoolean("kids_safe",false);
            JSONArray arr = json.optJSONArray("downloads");
            if (arr == null || arr.length() == 0) {
                if ((item.sourceUrl != null && !item.sourceUrl.isEmpty())
                        || (item.token != null && !item.token.isEmpty())) {
                    return true;
                }
                item.error = "no_source";
                return false;
            }
            JSONObject pick = pickObj(arr, item.quality, item.serverName);
            item.token = pick == null ? "" : pick.optString("token");
            item.sourceUrl = cleanDlUrl(pick);
            if (pick != null && (item.serverName == null || item.serverName.isEmpty())) {
                item.serverName = pick.optString("name");
            }
            String poster = json.optString("poster_path");
            if ((item.poster == null || item.poster.isEmpty()) && poster != null && !poster.isEmpty()) {
                item.poster = poster;
            }
            String title = json.optString("title");
            if ((item.title == null || item.title.isEmpty()) && title != null && !title.isEmpty()) {
                item.title = title;
            }
            if ((item.token == null || item.token.isEmpty())
                    && (item.sourceUrl == null || item.sourceUrl.isEmpty())) {
                item.error = "no_source";
                return false;
            }
            return true;
        } catch (Exception e) {
            item.error = e.getMessage() == null ? "fail" : e.getMessage();
            return false;
        }
    }

    public static String pickToken(JSONArray arr, String quality) {
        JSONObject o = pickObj(arr, quality, null);
        return o == null ? "" : o.optString("token");
    }

    public static String pickUrl(JSONArray arr, String quality) {
        JSONObject o = pickObj(arr, quality, null);
        return cleanDlUrl(o);
    }

    public static String cleanDlUrl(JSONObject o) {
        if (o == null) return "";
        String url = o.optString("url");
        if (badDl(url)) url = o.optString("play");
        if (badDl(url)) url = o.optString("href");
        if (badDl(url)) return "";
        return url;
    }

    private static boolean badDl(String url) {
        if (url == null || url.isEmpty() || "null".equalsIgnoreCase(url)) return true;
        String u = url.toLowerCase();
        return u.contains("/watch/") || u.contains("/api/secure_play");
    }

    private static JSONObject pickObj(JSONArray arr, String quality, String serverName) {
        if (arr == null || arr.length() == 0) return null;
        if (serverName != null && !serverName.isEmpty()) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && serverName.equalsIgnoreCase(o.optString("name"))) return o;
            }
        }
        int i;
        if (Q_BEST.equals(quality)) i = 0;
        else if (Q_SAVER.equals(quality)) i = arr.length() - 1;
        else i = Math.max(0, arr.length() / 2);
        if (i >= arr.length()) i = arr.length() - 1;
        return arr.optJSONObject(i);
    }

    private static boolean saveVideo(Item item) throws Exception {
        if ((item.token == null || item.token.isEmpty())
                && (item.sourceUrl == null || item.sourceUrl.isEmpty())) {
            item.error = "no_source";
            return false;
        }
        String frame = (item.token != null && !item.token.isEmpty())
                ? Api.abs("/download-frame/" + item.token)
                : item.sourceUrl;
        if (frame != null && frame.startsWith("/")) frame = Api.abs(frame);
        Request req = new Request.Builder().url(frame)
                .header("Accept", "*/*")
                .header("User-Agent", UA)
                .get()
                .build();
        try (Response res = dlHttp().newCall(req).execute()) {
            if (res.body() == null) {
                item.error = "empty";
                return false;
            }
            if (!res.isSuccessful()) {
                item.error = "http_" + res.code();
                return false;
            }
            String ctype = String.valueOf(res.header("Content-Type", "")).toLowerCase();
            String loc = res.request().url().toString().toLowerCase();
            byte[] head = new byte[64];
            InputStream raw = res.body().byteStream();
            int hn = raw.read(head);
            if (hn <= 0) {
                item.error = "empty";
                return false;
            }
            if (isHls(head, hn) || loc.endsWith(".m3u8") || loc.endsWith(".m3u")
                    || ctype.contains("mpegurl") || ctype.contains("x-mpegurl")) {
                item.error = "hls";
                return false;
            }
            boolean html = isHtmlOrText(ctype, head, hn) || head[0] == '<';
            if (html) {
                StringBuilder sb = new StringBuilder();
                sb.append(new String(head, 0, hn, java.nio.charset.StandardCharsets.ISO_8859_1));
                byte[] buf = new byte[16 * 1024];
                int n;
                int cap = 0;
                while (cap < 400_000 && (n = raw.read(buf)) >= 0) {
                    if (AccessGate.cachedBlocked()) throw new AccessGate.Restricted();
                    sb.append(new String(buf, 0, n, java.nio.charset.StandardCharsets.ISO_8859_1));
                    cap += n;
                }
                List<String> links = extractFileUrls(sb.toString());
                for (String link : links) {
                    if (item.cancel) return false;
                    if (copyUrl(item, link, loc, UA)) return true;
                }
                AccessGate.requireAllowed();
                DownloadCatch.Hit hit = DownloadCatch.grab(frame, 90_000);
                if (hit != null && hit.url != null && !hit.url.isEmpty()) {
                    String ua = hit.ua == null || hit.ua.isEmpty() ? UA : hit.ua;
                    if (copyUrl(item, hit.url, hit.referer, ua)) return true;
                }
                item.error = "no_file";
                return false;
            }
            item.total = res.body().contentLength();
            return copyStream(item, raw, head, hn, ctype, loc);
        }
    }

    private static boolean copyUrl(Item item, String url, String referer, String ua) throws Exception {
        if (url == null || url.isEmpty() || DownloadCatch.isJunk(url)) return false;
        Request.Builder b = new Request.Builder().url(url)
                .header("Accept", "*/*")
                .header("User-Agent", ua == null || ua.isEmpty() ? UA : ua);
        if (referer != null && !referer.isEmpty()) b.header("Referer", referer);
        try {
            String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) b.header("Cookie", cookie);
        } catch (Exception ignored) {}
        try (Response res = dlHttp().newCall(b.get().build()).execute()) {
            if (res.body() == null || !res.isSuccessful()) return false;
            String ctype = String.valueOf(res.header("Content-Type", "")).toLowerCase();
            String loc = res.request().url().toString().toLowerCase();
            InputStream in = res.body().byteStream();
            byte[] head = new byte[64];
            int hn = in.read(head);
            if (hn <= 0) return false;
            if (isHtmlOrText(ctype, head, hn) || head[0] == '<' || isHls(head, hn)) return false;
            item.total = res.body().contentLength();
            String cd = String.valueOf(res.header("Content-Disposition", "")).toLowerCase();
            if (cd.contains(".mkv")) loc = loc + ".mkv";
            return copyStream(item, in, head, hn, ctype, loc);
        } catch (AccessGate.Restricted restricted) {
            throw restricted;
        } catch (Exception e) {
            if (AccessGate.cachedBlocked()) throw new AccessGate.Restricted();
            return false;
        }
    }

    private static boolean copyStream(Item item, InputStream in, byte[] head, int hn, String ctype, String loc) throws Exception {
        if (AccessGate.cachedBlocked()) throw new AccessGate.Restricted();
        File out = new File(dir(), safe(item.key) + ext(ctype, loc));
        File tmp = new File(out.getAbsolutePath() + ".part");
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(head, 0, hn);
            long got = hn;
            long last = 0;
            byte[] buf = new byte[32 * 1024];
            int n;
            while ((n = in.read(buf)) >= 0) {
                if (AccessGate.cachedBlocked()) throw new AccessGate.Restricted();
                if (item.cancel || !listed(item)) {
                    tmp.delete();
                    return false;
                }
                fos.write(buf, 0, n);
                got += n;
                item.bytes = got;
                if (item.total > 0) item.progress = (int) Math.min(99, (got * 100) / item.total);
                else item.progress = 0;
                if (System.currentTimeMillis() - last > 400) {
                    last = System.currentTimeMillis();
                    fire();
                }
            }
            fos.flush();
        }
        if (tmp.length() < MIN_FILE) {
            tmp.delete();
            item.error = "no_file";
            return false;
        }
        if (out.exists()) out.delete();
        if (!tmp.renameTo(out)) {
            tmp.delete();
            item.error = "fail";
            return false;
        }
        item.path = out.getAbsolutePath();
        item.bytes = out.length();
        item.progress = 100;
        item.error = "";
        return true;
    }

    private static List<String> extractFileUrls(String html) {
        List<String> out = new ArrayList<>();
        if (html == null || html.isEmpty()) return out;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("https?://[^\\s\"'<>]+\\.(mkv|mp4|avi|webm|mov)(\\?[^\\s\"'<>]*)?", java.util.regex.Pattern.CASE_INSENSITIVE)
                .matcher(html);
        while (m.find()) {
            String u = m.group();
            if (!out.contains(u) && !DownloadCatch.isJunk(u)) out.add(u);
        }
        return out;
    }

    private static boolean isHtmlOrText(String ctype, byte[] head, int n) {
        if (ctype.contains("text/html") || ctype.contains("application/json") || ctype.contains("text/plain")
                || ctype.contains("text/xml") || ctype.contains("application/xml")) return true;
        if (n > 0 && (head[0] == '{' || head[0] == '[')) return true;
        String s = new String(head, 0, n, java.nio.charset.StandardCharsets.ISO_8859_1).trim().toLowerCase();
        return s.startsWith("<!doctype") || s.startsWith("<html") || s.startsWith("<?xml");
    }

    private static boolean isHls(byte[] head, int n) {
        String s = new String(head, 0, n, java.nio.charset.StandardCharsets.ISO_8859_1).trim();
        return s.startsWith("#EXTM3U") || s.startsWith("#EXT-X");
    }

    private static void savePoster(Item item) {
        String url = item.poster;
        if (url == null || url.isEmpty()) return;
        if (!url.startsWith("http")) {
            url = Api.img(Models.Session.imageBase, url, Q_SAVER.equals(item.quality) ? "w342" : "original");
        }
        if (url == null || url.isEmpty()) return;
        try {
            Request req = new Request.Builder().url(url).header("User-Agent", UA).get().build();
            try (Response res = Api.client().newCall(req).execute()) {
                if (res.body() == null) return;
                File art = artFile(item);
                try (InputStream in = res.body().byteStream(); FileOutputStream fos = new FileOutputStream(art)) {
                    byte[] buf = new byte[16 * 1024];
                    int n;
                    while ((n = in.read(buf)) >= 0) fos.write(buf, 0, n);
                }
            }
        } catch (Exception ignored) {}
    }

    private static String ext(String ctype, String path) {
        if (ctype.contains("webm") || path.endsWith(".webm")) return ".webm";
        if (ctype.contains("matroska") || path.endsWith(".mkv")) return ".mkv";
        return ".mp4";
    }

    private static OkHttpClient dlHttp() {
        if (dlHttp == null) {
            dlHttp = Api.client().newBuilder()
                    .cache(null)
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .writeTimeout(0, TimeUnit.MILLISECONDS)
                    .callTimeout(0, TimeUnit.MILLISECONDS)
                    .connectTimeout(30, TimeUnit.SECONDS)
                    .followRedirects(true)
                    .followSslRedirects(true)
                    .build();
        }
        return dlHttp;
    }

    private static File dir() {
        File d = CineAmitApp.get().getExternalFilesDir("cine_dl");
        if (d == null) d = new File(CineAmitApp.get().getFilesDir(), "cine_dl");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static String safe(String k) {
        return String.valueOf(k).replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private static void wipeFiles(Item item) {
        if (item == null) return;
        String prefix = safe(item.key);
        File d = dir();
        File[] files = d == null ? null : d.listFiles();
        if (files != null) {
            for (File f : files) {
                String n = f.getName();
                if (n.equals(prefix + ".jpg") || n.startsWith(prefix + ".")) {
                    try { f.delete(); } catch (Exception ignored) {}
                }
            }
        }
        if (item.path != null && !item.path.isEmpty()) {
            try { new File(item.path).delete(); } catch (Exception ignored) {}
        }
        item.path = "";
    }

    private static boolean onWifi() {
        try {
            ConnectivityManager cm = (ConnectivityManager) CineAmitApp.get().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            Network n = cm.getActiveNetwork();
            NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
            return c != null && c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
        } catch (Exception e) {
            return false;
        }
    }

    private static void load() {
        if (loaded) return;
        loaded = true;
        ITEMS.clear();
        try {
            JSONArray arr = new JSONArray(CineAmitApp.prefs().getString("dl_index", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                Item it = new Item();
                it.key = o.optString("key");
                it.type = o.optString("type", "movie");
                it.id = o.optLong("id");
                it.s = Math.max(1, o.optInt("s", 1));
                it.e = Math.max(1, o.optInt("e", 1));
                it.title = o.optString("title");
                it.poster = o.optString("poster");
                it.quality = o.optString("quality", Q_HIGH);
                it.status = o.optString("status", ST_DONE);
                it.path = o.optString("path");
                it.token = o.optString("token");
                it.sourceUrl = o.optString("sourceUrl");
                it.error = o.optString("error");
                it.bytes = o.optLong("bytes");
                it.total = o.optLong("total");
                it.created = o.optLong("created");
                it.expires = o.optLong("expires");
                it.progress = o.optInt("progress");
                it.folder = o.optString("folder");
                it.priv = o.optBoolean("priv", false);
                it.kidsSafe=o.optBoolean("kidsSafe",false);
                it.toGallery = o.optBoolean("toGallery", false);
                it.galleryUri = o.optString("galleryUri");
                if (it.folder == null || it.folder.isEmpty()) it.folder = defaultFolder(it.type);
                if (FOLDER_PRIVATE.equalsIgnoreCase(it.folder)) {
                    it.priv = true;
                    it.folder = defaultFolder(it.type);
                }
                if (ST_RUN.equals(it.status)) it.status = ST_QUEUED;
                if ("online".equals(it.error) && ST_DONE.equals(it.status) && !canPlayOffline(it)) {
                    it.status = ST_FAIL;
                    it.error = "no_file";
                }
                ITEMS.add(it);
            }
        } catch (Exception ignored) {}
        pruneExpired();
        scrubParts();
    }

    private static void pruneExpired() {
        long now = System.currentTimeMillis();
        Iterator<Item> it = ITEMS.iterator();
        boolean ch = false;
        while (it.hasNext()) {
            Item x = it.next();
            if (x.expires > 0 && x.expires < now) {
                wipeFiles(x);
                it.remove();
                ch = true;
            }
        }
        if (ch) persist();
    }

    private static void scrubParts() {
        File d = dir();
        File[] files = d == null ? null : d.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.getName().endsWith(".part")) {
                boolean live = false;
                for (Item it : ITEMS) {
                    if (ST_RUN.equals(it.status) && f.getName().startsWith(safe(it.key))) {
                        live = true;
                        break;
                    }
                }
                if (!live) try { f.delete(); } catch (Exception ignored) {}
            }
        }
    }

    private static void persist() {
        JSONArray arr = new JSONArray();
        synchronized (Downloads.class) {
            for (Item it : ITEMS) {
                try {
                    arr.put(new JSONObject()
                            .put("key", it.key)
                            .put("type", it.type)
                            .put("id", it.id)
                            .put("s", it.s)
                            .put("e", it.e)
                            .put("title", it.title)
                            .put("poster", it.poster)
                            .put("quality", it.quality)
                            .put("status", it.status)
                            .put("path", it.path)
                            .put("token", it.token)
                            .put("error", it.error)
                            .put("bytes", it.bytes)
                            .put("total", it.total)
                            .put("created", it.created)
                            .put("expires", it.expires)
                            .put("progress", it.progress)
                            .put("folder", it.folder == null || it.folder.isEmpty() ? defaultFolder(it.type) : it.folder)
                            .put("priv", it.priv)
                            .put("kidsSafe",it.kidsSafe)
                            .put("toGallery", it.toGallery)
                            .put("galleryUri", it.galleryUri == null ? "" : it.galleryUri));
                } catch (Exception ignored) {}
            }
        }
        CineAmitApp.prefs().edit().putString("dl_index", arr.toString()).apply();
    }

    private static void fire() {
        MAIN.post(() -> {
            for (Listener l : LISTENERS) {
                try { l.onDownloads(); } catch (Exception ignored) {}
            }
        });
    }
}
