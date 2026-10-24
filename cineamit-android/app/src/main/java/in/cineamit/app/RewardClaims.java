package in.cineamit.app;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;
import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.Session;

/** Durable reconciliation only. A client SDK callback NEVER credits a wallet. */
public final class RewardClaims {
    private static final String KEY = "pending_verified_rewards_v1";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final Runnable RETRY = RewardClaims::resume;
    private static final Map<String, Notice> NOTICES = new HashMap<>();
    private static boolean inFlight;
    private static final class Notice {
        final WeakReference<Activity> owner;
        final Ads.RewardAction action;
        Notice(Activity a, Ads.RewardAction callback) { owner = new WeakReference<>(a); action = callback; }
    }
    private RewardClaims() {}
    private static JSONArray read() {
        try { return new JSONArray(CineAmitApp.prefs().getString(KEY, "[]")); }
        catch (Exception error) { return new JSONArray(); }
    }
    private static void write(JSONArray list) { CineAmitApp.prefs().edit().putString(KEY, list.toString()).apply(); }
    public static void watch(Activity owner, long uid, String ticket, Ads.RewardAction action) {
        try {
            JSONArray all = read();
            for (int i = 0; i < all.length(); i++) if (ticket.equals(all.getJSONObject(i).optString("ticket"))) return;
            JSONObject item = new JSONObject(); item.put("user", uid); item.put("ticket", ticket);
            item.put("until", System.currentTimeMillis() + 12 * 60_000L); item.put("tries", 0); item.put("next", 0);
            if (all.length() >= 64) throw new IllegalStateException("Too many pending reward checks");
            all.put(item);
            // The intent must reach disk BEFORE inventory is shown; apply() alone can lose it on process death.
            if (!CineAmitApp.prefs().edit().putString(KEY, all.toString()).commit())
                throw new IllegalStateException("Cannot persist reward verification intent");
            NOTICES.put(ticket, new Notice(owner, action));
        } catch (Exception error) { throw new IllegalStateException("Cannot retain reward verification intent", error); }
    }
    public static void detach(Activity owner) {
        NOTICES.entrySet().removeIf(e -> e.getValue().owner.get() == owner || e.getValue().owner.get() == null);
    }
    private static void remove(String ticket) {
        JSONArray kept = new JSONArray(), all = read();
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && !ticket.equals(item.optString("ticket"))) kept.put(item);
        }
        write(kept);
    }
    public static void resume() {
        if (Looper.myLooper() != Looper.getMainLooper()) { MAIN.post(RewardClaims::resume); return; }
        MAIN.removeCallbacks(RETRY);
        Activity a = CineAmitApp.foreground();
        if (inFlight || Session.user == null || !Io.alive(a) || !AppScreens.canHostAds(a) || Ads.isFullScreenShowing()) return;
        long uid = Session.user.id, now = System.currentTimeMillis();
        JSONArray all = read(), kept = new JSONArray(); JSONObject selected = null; long earliest = Long.MAX_VALUE;
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.optJSONObject(i);
            if (item == null || item.optLong("until") <= now) { if (item != null) NOTICES.remove(item.optString("ticket")); continue; }
            kept.put(item);
            if (item.optLong("user") != uid) continue;
            long next = item.optLong("next");
            if (selected == null && next <= now) selected = item;
            earliest = Math.min(earliest, next);
        }
        write(kept);
        if (selected == null) {
            if (earliest != Long.MAX_VALUE) MAIN.postDelayed(RETRY, Math.max(1000, earliest - now));
            return;
        }
        JSONObject claim = selected; String ticket = claim.optString("ticket"); inFlight = true;
        Io.run(() -> Api.walletRewardStatus(ticket), result -> {
            inFlight = false;
            if (Session.user == null || Session.user.id != uid) { MAIN.post(RETRY); return; }
            if (result != null && result.optBoolean("ok") && result.optBoolean("credited")) {
                Sub.applyRemote(result); remove(ticket); Notice notice = NOTICES.remove(ticket);
                try { result.put("added", result.optInt("credited_points", result.optInt("added", 0))); } catch (Exception ignored) {}
                Activity current = CineAmitApp.foreground();
                if (notice != null && notice.action != null && Io.alive(notice.owner.get()) && notice.owner.get() == current) {
                    try { notice.action.earned(result); } catch (RuntimeException ignored) {}
                } else if (Io.alive(current) && AppScreens.canHostAds(current)) {
                    Toast.makeText(current, "Reward verified · points synced", Toast.LENGTH_SHORT).show();
                }
            } else if (result != null && ("ticket".equals(result.optString("error")) || "expired".equals(result.optString("error")))) {
                remove(ticket); NOTICES.remove(ticket);
            } else defer(ticket);
            MAIN.postDelayed(RETRY, 1000);
        }, error -> { inFlight = false; defer(ticket); MAIN.postDelayed(RETRY, 5000); });
    }
    private static void defer(String ticket) {
        JSONArray all = read();
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.optJSONObject(i);
            if (item == null || !ticket.equals(item.optString("ticket"))) continue;
            try {
                int tries = item.optInt("tries") + 1;
                item.put("tries", tries);
                item.put("next", System.currentTimeMillis() + Math.min(60_000L, 5000L << Math.min(tries - 1, 4)));
            } catch (Exception ignored) {}
        }
        write(all);
    }
}
