package in.cineamit.app;

import android.app.Activity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.Session;

/** GA4 via Node Measurement Protocol — uses website GA_MEASUREMENT_ID. No IDs in the APK. */
public final class Analytics {
    private static final Object LOCK = new Object();
    private static final JSONArray QUEUE = new JSONArray();
    private static final android.os.Handler MAIN = new android.os.Handler(android.os.Looper.getMainLooper());
    private static boolean pending = true;
    private static boolean enabled;
    private static boolean flushing;
    private static boolean opened;
    private static String lastScreen = "";
    private static Runnable flushRun;
    private static final long SESSION = System.currentTimeMillis() / 1000L;
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    private Analytics() {}

    public static void setEnabled(boolean on) {
        synchronized (LOCK) {
            enabled = on;
            pending = false;
            if (!on) {
                while (QUEUE.length() > 0) QUEUE.remove(0);
                return;
            }
        }
        flush();
    }

    public static void appOpen() {
        if (opened) return;
        opened = true;
        event("app_open", null);
    }

    public static void screen(Activity a) {
        if (a == null) return;
        String cls = a.getClass().getSimpleName();
        String name = cls.endsWith("Activity") ? cls.substring(0, cls.length() - 8) : cls;
        if (name.isEmpty()) name = cls;
        if (name.equals(lastScreen)) return;
        lastScreen = name;
        JSONObject p = new JSONObject();
        put(p, "screen_name", name);
        put(p, "screen_class", cls);
        event("screen_view", p);
    }

    public static void login() { event("login", null); }

    public static void signUp() { event("sign_up", null); }

    public static void search(String q) {
        JSONObject p = new JSONObject();
        put(p, "search_term", q == null ? "" : q.trim());
        event("search", p);
    }

    public static void select(String type, long id) {
        JSONObject p = new JSONObject();
        put(p, "content_type", type == null ? "" : type);
        put(p, "item_id", String.valueOf(id));
        event("select_content", p);
    }

    public static void watch(String type, long id) {
        JSONObject p = new JSONObject();
        put(p, "content_type", type == null ? "" : type);
        put(p, "item_id", String.valueOf(id));
        event("watch_start", p);
    }

    public static void live() { event("live_tv", null); }

    public static void event(String name, JSONObject params) {
        if (Session.user != null && Session.user.is_kids) return;
        if (name == null || name.isEmpty()) return;
        JSONObject row = new JSONObject();
        put(row, "name", name);
        try {
            JSONObject p = params == null ? new JSONObject() : params;
            p.put("engagement_time_msec", 1);
            p.put("session_id", SESSION);
            p.put("app_version", BuildConfig.VERSION_NAME);
            row.put("params", p);
        } catch (Exception ignored) {}
        synchronized (LOCK) {
            if (!pending && !enabled) return;
            if (QUEUE.length() >= 40) QUEUE.remove(0);
            QUEUE.put(row);
        }
        if (flushRun != null) MAIN.removeCallbacks(flushRun);
        flushRun = Analytics::flush;
        MAIN.postDelayed(flushRun, 700);
    }

    private static void put(JSONObject o, String k, String v) {
        try { o.put(k, v == null ? "" : v); } catch (Exception ignored) {}
    }

    private static String clientId() {
        String id = CineAmitApp.prefs().getString("ga_cid", "");
        if (id == null || id.length() < 8) {
            id = UUID.randomUUID().toString();
            CineAmitApp.prefs().edit().putString("ga_cid", id).apply();
        }
        return id;
    }

    private static void flush() {
        final JSONArray batch;
        synchronized (LOCK) {
            if (pending || !enabled || flushing || QUEUE.length() == 0) return;
            flushing = true;
            batch = new JSONArray();
            for (int i = 0; i < QUEUE.length(); i++) batch.put(QUEUE.optJSONObject(i));
            while (QUEUE.length() > 0) QUEUE.remove(0);
        }
        IO.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("client_id", clientId());
                body.put("events", batch);
                Api.ga(body);
            } catch (Exception ignored) {
            } finally {
                synchronized (LOCK) { flushing = false; }
            }
        });
    }
}
