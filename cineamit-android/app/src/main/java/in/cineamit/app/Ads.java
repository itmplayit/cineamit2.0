package in.cineamit.app;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.unity3d.services.banners.BannerView;
import com.unity3d.services.banners.UnityBannerSize;
import com.unity3d.services.banners.BannerErrorInfo;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Map;
import java.util.WeakHashMap;
import org.json.JSONObject;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.data.Api;

/** Unity-only main-thread coordinator. One fullscreen owner; never client-authorized credit. */
public final class Ads {
    static final String TAG = "CineAds";
    public static final int BANNER_DP = 50;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final Map<FrameLayout, BannerSlot> BANNERS = new WeakHashMap<>();
    private static final HashSet<Integer> FRESH = new HashSet<>();
    private static boolean configured, metadataReady;
    private static Opportunity pending;
    private static long lastInterAt = -1;
    private static long navigationGeneration;
    private Ads() {}
    public interface RewardAction { void earned(JSONObject verifiedResult); }
    public static boolean enabled() {
        return !AccessGate.blocked() && BuildConfig.UNITY_ENABLED && (Session.user == null || !Session.user.is_kids)
            && !Sub.isPremium() && Sub.adsMaster();
    }
    public static boolean bannersOn() { return enabled() && Sub.adsBanner(); }
    public static boolean interOn() { return enabled() && Sub.adsInterstitial(); }
    public static boolean rewardOn() { return enabled() && Sub.adsRewarded(); }
    public static int bannerReserveDp() { return bannersOn() ? BANNER_DP + 6 : 0; }
    public static int bannerReservePx(Context c) { return c == null ? 0 : Math.round(bannerReserveDp() * c.getResources().getDisplayMetrics().density); }
    public static void init(Application app) {
        if (Looper.myLooper() != Looper.getMainLooper()) { MAIN.post(() -> init(app)); return; }
        if (app == null || configured) return;
        configured = true;
        // One-time old-provider/rotation cache cleanup; no SDK is called here.
        CineAmitApp.prefs().edit().remove("eco_reward_admob")
            .remove("ad_next_unity_banner").remove("ad_next_unity_interstitial").remove("ad_next_unity_rewarded")
            .putBoolean("eco_reward_unity", false).putBoolean("eco_reward_verify", false).apply();
        Log.i(TAG, "Unity-only configured; version=" + BuildConfig.VERSION_NAME + "/" + BuildConfig.VERSION_CODE
            + "; testMode=" + BuildConfig.UNITY_TEST_MODE + "; config=" + BuildConfig.UNITY_CONFIG_FINGERPRINT);
    }
    public static void onMetadataReady() { MAIN.post(() -> { metadataReady = true; onResume(CineAmitApp.foreground()); }); }
    public static boolean isFullScreenShowing() { return UnityDirect.isShowing(); }
    static boolean eligibleForShow(Activity a) {
        return metadataReady && Io.alive(a) && a == CineAmitApp.foreground()
            && AppScreens.canHostAds(a) && enabled() && AdsPrivacy.canRequest();
    }
    static boolean eligible(Activity a) { return eligibleForShow(a) && !isFullScreenShowing(); }
    private static long now() { return SystemClock.elapsedRealtime(); }
    public static void onResume(Activity a) {
        if (Looper.myLooper() != Looper.getMainLooper()) { MAIN.post(() -> onResume(a)); return; }
        if (!Io.alive(a) || a != CineAmitApp.foreground() || !AppScreens.canHostAds(a) || isFullScreenShowing()) return;
        if (!enabled()) { clearCachedAds(); attachBanner(a); return; }
        if (!metadataReady) return;
        AdsPrivacy.gather(a, () -> {
            Activity current = CineAmitApp.foreground();
            if (!eligible(current)) return;
            if (!bannersOn()) for (FrameLayout h : new ArrayList<>(BANNERS.keySet())) recycleBanner(h);
            UnityDirect.warm(current);
            attachBanner(current);
            for (BannerSlot slot : new ArrayList<>(BANNERS.values())) {
                FrameLayout h = slot.host.get();
                if (slot.owner.get() != current || h == null) continue;
                h.setVisibility(View.VISIBLE); beginBanner(slot);
            }
        });
    }
    public static void onPause(Activity a) {
        if (!isFullScreenShowing()) navigationGeneration++;
        for (BannerSlot slot : new ArrayList<>(BANNERS.values())) if (slot.owner.get() == a) {
            FrameLayout host = slot.host.get(); if (host != null) host.setVisibility(View.INVISIBLE);
        }
        if (pending != null && pending.owner.get() == a && !isFullScreenShowing()) cancelPending();
    }
    public static void dropFresh(Activity a) {
        if (a == null) return;
        FRESH.remove(System.identityHashCode(a));
        if (pending != null && pending.owner.get() == a && !isFullScreenShowing()) cancelPending();
        for (BannerSlot slot : new ArrayList<>(BANNERS.values())) if (slot.owner.get() == a) recycleBanner(slot.host.get());
    }
    public static void markFresh(Activity a) { if (a != null) FRESH.add(System.identityHashCode(a)); }
    public static void consumeFreshOpen(Activity a) { if (a != null && FRESH.remove(System.identityHashCode(a))) onPageOpen(a); }
    public static void onNavigate(Activity a) {
        navigationGeneration++;
        if (pending != null && !isFullScreenShowing()) cancelPending();
        onPageOpen(a);
    }
    public static void onPageOpen(Activity a) {
        if (!interOn() || !Sub.adsInterEveryPage() || !Io.alive(a) || !AppScreens.canHostAds(a)) return;
        WeakReference<Activity> owner = new WeakReference<>(a);
        long generation = navigationGeneration;
        MAIN.postDelayed(() -> { Activity current = owner.get(); if (generation == navigationGeneration && eligible(current) && pending == null) showInterstitial(current, null); }, 400);
    }
    public static void showInterstitial(Activity a, Runnable after) {
        if (Looper.myLooper() != Looper.getMainLooper()) { MAIN.post(() -> showInterstitial(a, after)); return; }
        if (!interOn() || !eligible(a) || pending != null || (lastInterAt >= 0 && now() - lastInterAt < Sub.interGapMs())) {
            if (after != null && Io.alive(a)) after.run(); return;
        }
        start(new Opportunity(a, false, null, after));
    }
    public static void showRewarded(Activity a, RewardAction action) {
        if (Looper.myLooper() != Looper.getMainLooper()) { MAIN.post(() -> showRewarded(a, action)); return; }
        if (!rewardOn() || !eligible(a) || Session.user == null || pending != null) {
            toast(a, "Ad is unavailable, already opening, or privacy setup is pending."); onResume(a); return;
        }
        start(new Opportunity(a, true, action, null));
    }
    private static final class Opportunity {
        final WeakReference<Activity> owner;
        final long uid;
        final boolean reward;
        final RewardAction action;
        final Runnable after;
        final long deadline;
        final long navigation;
        boolean delegated;
        Runnable poll, timeout;
        Opportunity(Activity a, boolean reward, RewardAction action, Runnable after) {
            navigation = ++navigationGeneration;
            owner = new WeakReference<>(a); uid = Session.user == null ? 0 : Session.user.id;
            this.reward = reward; this.action = action; this.after = after;
            deadline = now() + (reward ? 20_000 : 9_000);
        }
    }
    private static boolean valid(Opportunity r) {
        return pending == r && eligibleForShow(r.owner.get()) && (r.reward
            ? rewardOn() && Session.user != null && Session.user.id == r.uid : interOn());
    }
    private static void start(Opportunity r) {
        pending = r;
        r.poll = () -> probe(r);
        r.timeout = () -> { if (pending == r && !isFullScreenShowing()) { toast(r.owner.get(), r.reward ? "Ad not ready. Please try again later." : null); cancelPending(); } };
        MAIN.postDelayed(r.timeout, Math.max(0, r.deadline - now()));
        onResume(r.owner.get());
        probe(r);
    }
    private static void probe(Opportunity r) {
        if (pending != r || r.delegated) return;
        if (!valid(r) || now() >= r.deadline || isFullScreenShowing()) { finish(r); return; }
        if (r.reward && !Sub.rewardProviderReady()) { unavailable(r); return; }
        if (UnityDirect.cached(r.reward)) { display(r); return; }
        if (UnityDirect.cooling(r.reward)) { unavailable(r); return; }
        MAIN.removeCallbacks(r.poll); MAIN.postDelayed(r.poll, 200);
    }
    private static void unavailable(Opportunity r) {
        if (pending != r) return;
        if (r.reward) toast(r.owner.get(), "No verified Unity rewarded ad is available. Please try again later.");
        finish(r);
    }
    private static void display(Opportunity r) {
        if (!valid(r)) { finish(r); return; }
        r.delegated = true;
        if (!r.reward) {
            lastInterAt = now();
            UnityDirect.show(r.owner.get(), false, null, null, shown -> { if (shown) finish(r); else unavailable(r); });
            return;
        }
        Io.run(() -> Api.walletTicket(UnityDirect.rewardUnit()), json -> {
            if (!valid(r)) { if (pending == r) finish(r); return; }
            if (json != null && !json.optBoolean("ok")) {
                String reason = json.optString("error");
                if ("daily_limit".equals(reason) || "reward_cooldown".equals(reason) || "pending_limit".equals(reason)) {
                    String message = json.optString("message", "Please wait before the next reward.");
                    toast(r.owner.get(), message.length() > 180 ? message.substring(0, 180) : message);
                    finish(r); return;
                }
            }
            if (now() >= r.deadline || json == null || !json.optBoolean("ok") || !json.optString("ticket").matches("[a-f0-9]{32}")) { unavailable(r); return; }
            String ticket = json.optString("ticket");
            try { RewardClaims.watch(r.owner.get(), r.uid, ticket, r.action); }
            catch (RuntimeException e) { unavailable(r); return; }
            UnityDirect.show(r.owner.get(), true, r.uid + "." + ticket,
                () -> toast(r.owner.get(), "Ad completed · checking server reward confirmation…"),
                shown -> { if (shown) finish(r); else unavailable(r); });
        }, e -> { if (pending == r) unavailable(r); });
    }
    private static void finish(Opportunity r) { finish(r, true); }
    private static void finish(Opportunity r, boolean notify) {
        if (pending != r) return;
        pending = null; MAIN.removeCallbacks(r.poll); MAIN.removeCallbacks(r.timeout);
        Activity a = r.owner.get();
        if (notify && r.after != null) deliverAfter(r, 0);
        MAIN.post(() -> { onResume(CineAmitApp.foreground()); RewardClaims.resume(); });
    }
    private static void deliverAfter(Opportunity r, int tries) {
        Activity a = r.owner.get();
        if (!Io.alive(a) || r.navigation != navigationGeneration || pending != null) return;
        if (a == CineAmitApp.foreground()) r.after.run();
        else if (tries < 6) MAIN.postDelayed(() -> deliverAfter(r, tries + 1), 250);
    }
    private static void cancelPending() {
        Opportunity r = pending; if (r == null || isFullScreenShowing()) return;
        // A cancelled navigation must never deliver a delayed fullscreen or continuation.
        finish(r, false);
    }

    public static void attachBanner(Activity a) {
        if (!Io.alive(a) || !AppScreens.canHostAds(a)) return;
        View existing = a.findViewById(R.id.cineAdBanner);
        removeHost(a.findViewById(R.id.cineAdBannerTop));
        if (!bannersOn()) { removeHost(existing); bumpIsland(a); return; }
        if (!eligible(a)) return;
        ViewGroup content = a.findViewById(android.R.id.content);
        if (content == null) return;
        if (existing instanceof FrameLayout) {
            FrameLayout host = (FrameLayout) existing;
            host.bringToFront();
            fillBanner(a, host);
        } else {
            FrameLayout host = new FrameLayout(a);
            host.setId(R.id.cineAdBanner);
            float d = a.getResources().getDisplayMetrics().density;
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, Math.round(BANNER_DP * d), Gravity.BOTTOM);
            host.setElevation(24f * d);
            content.addView(host, lp);
            ViewCompat.setOnApplyWindowInsetsListener(host, (v, insets) -> {
                FrameLayout.LayoutParams p = (FrameLayout.LayoutParams) v.getLayoutParams();
                p.bottomMargin = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
                v.setLayoutParams(p);
                bumpIsland(a);
                return insets;
            });
            ViewCompat.requestApplyInsets(host);
            fillBanner(a, host);
        }
        ViewCompat.requestApplyInsets(content);
        bumpIsland(a);
    }

    private static void removeHost(View view) {
        if (view instanceof FrameLayout) recycleBanner((FrameLayout) view);
        if (view != null && view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
    }
    private static void bumpIsland(Activity a) {
        View island = a.findViewById(R.id.islandNav);
        if (island != null) ViewCompat.requestApplyInsets(island);
    }
    public static void fillBanner(Context ctx, FrameLayout host) {
        if (host == null) return;
        Activity a = ctx instanceof Activity ? (Activity) ctx : CineAmitApp.foreground();
        if (!bannersOn()) { recycleBanner(host); host.setVisibility(View.GONE); return; }
        if (!Io.alive(a) || !AppScreens.canHostAds(a)) { recycleBanner(host); return; }
        BannerSlot slot = BANNERS.get(host);
        if (slot != null && slot.owner.get() != a) { recycleBanner(host); slot = null; }
        if (slot == null) { slot = new BannerSlot(a, host); BANNERS.put(host, slot); }
        host.setVisibility(View.VISIBLE); beginBanner(slot);
    }
    private static final class BannerSlot {
        final WeakReference<Activity> owner;
        final WeakReference<FrameLayout> host;
        final AdLoadState state = new AdLoadState();
        BannerView unity;
        Runnable task;
        long until;
        int serial, token;
        boolean loaded, working, requested;
        BannerSlot(Activity a, FrameLayout h) { owner = new WeakReference<>(a); host = new WeakReference<>(h); }
    }
    private static boolean validBanner(BannerSlot b, int serial) {
        FrameLayout host = b.host.get();
        return host != null && BANNERS.get(host) == b && b.serial == serial && bannersOn() && eligible(b.owner.get());
    }
    private static void beginBanner(BannerSlot b) {
        if (b.loaded || b.working || !eligible(b.owner.get()) || !bannersOn()) return;
        int token = b.state.begin(now()); if (token == 0) return;
        b.token = token; b.working = true; UnityDirect.warm(b.owner.get()); beginBannerRequest(b);
    }
    private static void disposeViews(BannerSlot b) {
        if (b.unity != null) { b.unity.setListener(null); b.unity.destroy(); b.unity = null; }
        FrameLayout host = b.host.get(); if (host != null) host.removeAllViews();
    }
    private static void beginBannerRequest(BannerSlot b) {
        b.serial++; b.requested = false; b.until = now() + 10_000; disposeViews(b);
        probeBanner(b, b.serial);
    }
    private static void probeBanner(BannerSlot b, int serial) {
        if (!validBanner(b, serial)) { pauseBannerAttempt(b, serial); return; }
        if (b.loaded) return;
        if (now() >= b.until) { AdDiagnostics.record("banner", "load", "failure", "TIMEOUT", BuildConfig.UNITY_BANNER_PLACEMENT); bannerFailed(b, serial); return; }
        if (!b.requested && UnityDirect.initialized()) {
            b.requested = true;
            Activity a = b.owner.get(); FrameLayout host = b.host.get();
            try {
                    BannerView view = new BannerView(a, BuildConfig.UNITY_BANNER_PLACEMENT, new UnityBannerSize(320, 50)); b.unity = view;
                    view.setListener(new BannerView.Listener() {
                        @Override public void onBannerLoaded(BannerView banner) { MAIN.post(() -> bannerLoaded(b, serial)); }
                        @Override public void onBannerFailedToLoad(BannerView banner, BannerErrorInfo error) {
                            MAIN.post(() -> { AdDiagnostics.record("banner", "load", "failure", String.valueOf(error.errorCode), BuildConfig.UNITY_BANNER_PLACEMENT); UnityDirect.log("banner load", "LOAD_ERROR", error.errorMessage); if (!b.loaded) bannerFailed(b, serial); });
                        }
                    });
                    host.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER)); view.load();
            } catch (RuntimeException e) { AdDiagnostics.record("banner", "load", "failure", e.getClass().getSimpleName(), BuildConfig.UNITY_BANNER_PLACEMENT); bannerFailed(b, serial); return; }
        }
        if (!b.loaded && validBanner(b, serial)) {
            if (b.task != null) MAIN.removeCallbacks(b.task);
            b.task = () -> probeBanner(b, serial); MAIN.postDelayed(b.task, 250);
        }
    }
    private static void pauseBannerAttempt(BannerSlot b, int serial) {
        if (b.serial != serial || b.loaded) return;
        if (b.task != null) MAIN.removeCallbacks(b.task);
        b.serial++; b.working = false; b.state.reset(); disposeViews(b);
    }
    private static void bannerLoaded(BannerSlot b, int serial) {
        if (!validBanner(b, serial)) { pauseBannerAttempt(b, serial); return; }
        if (b.loaded) return;
        b.loaded = true; b.working = false; b.state.loaded(b.token, now());
        if (b.task != null) MAIN.removeCallbacks(b.task);
        AdDiagnostics.record("banner", "load", "success", "LOADED", BuildConfig.UNITY_BANNER_PLACEMENT);
        Log.i(TAG, "UnityDirect banner shown");
    }
    private static void bannerFailed(BannerSlot b, int serial) {
        if (b.serial != serial || b.loaded) return;
        if (!validBanner(b, serial)) { pauseBannerAttempt(b, serial); return; }
        if (b.task != null) MAIN.removeCallbacks(b.task);
        b.serial++; disposeViews(b); b.working = false;
        if (b.state.failed(b.token, now())) {
            long delay = b.state.retryDelay(now());
            if (delay >= 0) { b.task = () -> beginBanner(b); MAIN.postDelayed(b.task, delay); }
        }
    }
    public static void recycleBanner(FrameLayout host) {
        if (host == null) return;
        BannerSlot b = BANNERS.remove(host);
        if (b != null) { b.serial++; b.state.reset(); if (b.task != null) MAIN.removeCallbacks(b.task); disposeViews(b); }
        host.removeAllViews(); host.setTag(null);
    }
    static void clearCachedAds() {
        if (!isFullScreenShowing()) cancelPending();
        UnityDirect.clear();
        for (FrameLayout h : new ArrayList<>(BANNERS.keySet())) { recycleBanner(h); if (h != null) h.setVisibility(View.GONE); }
    }
    public static void showPrivacyOptions(Activity a) { AdsPrivacy.showOptions(a); }
    private static void toast(Activity a, String text) { if (text != null && Io.alive(a)) Toast.makeText(a, text, Toast.LENGTH_SHORT).show(); }
}
