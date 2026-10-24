package in.cineamit.app;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.unity3d.ads.UnityAds;
import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.Session;
import java.util.ArrayDeque;
import java.util.HashMap;
import org.json.JSONArray;
import org.json.JSONObject;

/** Best-effort operational reports only. Never authorizes rewards or sends SDK messages/IDs. */
final class AdDiagnostics {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final ArrayDeque<JSONObject> QUEUE = new ArrayDeque<>();
    private static final HashMap<String, Long> RECENT = new HashMap<>();
    private static final int MAX_QUEUE = 40, MAX_BATCH = 10;
    private static long owner;
    private static boolean scheduled, flushing;
    private AdDiagnostics() {}

    private static boolean allowed() {
        return Sub.adsDiagnostics() && Sub.adsMaster() && Session.user != null && !Session.user.is_kids;
    }
    static void record(String format, String stage, String outcome, String code, String unit) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            final String rawCode = code, rawUnit = unit;
            MAIN.post(() -> record(format, stage, outcome, rawCode, rawUnit)); return;
        }
        if (!allowed()) { QUEUE.clear(); RECENT.clear(); return; }
        long uid = Session.user.id;
        if (owner != uid) { owner = uid; QUEUE.clear(); RECENT.clear(); }
        // Restrict caller data before it ever reaches an outbound payload.
        if (code == null || !code.matches("[A-Za-z0-9_.:-]{1,64}")) code = "UNKNOWN";
        if (unit == null || !unit.matches("[A-Za-z0-9_-]{0,60}")) unit = "";
        String key = format + ":" + stage + ":" + outcome + ":" + code + ":" + unit;
        long now = SystemClock.elapsedRealtime();
        Long last = RECENT.get(key);
        if (last != null && now - last < 10_000) return;
        if (RECENT.size() >= 100) RECENT.clear();
        RECENT.put(key, now);
        try {
            JSONObject event = new JSONObject().put("format", format).put("stage", stage).put("outcome", outcome)
                .put("code", code).put("unit", unit).put("app_version", BuildConfig.VERSION_NAME)
                .put("app_code", BuildConfig.VERSION_CODE).put("sdk_version", UnityAds.getVersion())
                .put("config_fingerprint", BuildConfig.UNITY_CONFIG_FINGERPRINT).put("test_mode", BuildConfig.UNITY_TEST_MODE);
            if (QUEUE.size() >= MAX_QUEUE) QUEUE.removeFirst();
            QUEUE.addLast(event);
            schedule();
        } catch (Exception ignored) { /* Diagnostics must never affect ads or rewards. */ }
    }
    private static void schedule() {
        if (scheduled || flushing || QUEUE.isEmpty()) return;
        scheduled = true;
        MAIN.postDelayed(AdDiagnostics::flush, 30_000);
    }
    private static void flush() {
        scheduled = false;
        if (!allowed() || Session.user.id != owner) { QUEUE.clear(); RECENT.clear(); return; }
        JSONArray batch = new JSONArray();
        while (!QUEUE.isEmpty() && batch.length() < MAX_BATCH) batch.put(QUEUE.removeFirst());
        if (batch.length() == 0) return;
        final long uid = owner;
        flushing = true;
        Io.run(() -> {
            if (Session.user == null || Session.user.id != uid || !allowed()) return null;
            return Api.adDiagnostics(new JSONObject().put("events", batch));
        }, result -> { flushing = false; schedule(); }, error -> {
            // No durable queue or retry storm. Dropped reports are not proof of ad failure.
            flushing = false; schedule();
        });
    }
}
