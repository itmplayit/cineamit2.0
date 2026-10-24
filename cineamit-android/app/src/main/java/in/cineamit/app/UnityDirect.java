package in.cineamit.app;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import com.unity3d.ads.UnityAds;
import com.unity3d.ads.IUnityAdsInitializationListener;
import com.unity3d.ads.IUnityAdsLoadListener;
import com.unity3d.ads.IUnityAdsShowListener;
import com.unity3d.ads.metadata.PlayerMetaData;
import java.util.concurrent.atomic.AtomicBoolean;

/** Independent Unity Ads SDK owner. No mediation or invented bid markup. */
final class UnityDirect {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final AdLoadState INIT = new AdLoadState(), INTER = new AdLoadState(), REWARD = new AdLoadState();
    private static boolean ready, interReady, rewardReady, showing;
    private UnityDirect() {}
    private static long now() { return SystemClock.elapsedRealtime(); }
    static boolean initialized() { return ready; }
    static boolean isShowing() { return showing; }
    static String rewardUnit() { return "unity:" + BuildConfig.UNITY_GAME_ID + ":" + BuildConfig.UNITY_REWARDED_PLACEMENT; }
    static String placement(boolean reward) { return reward ? BuildConfig.UNITY_REWARDED_PLACEMENT : BuildConfig.UNITY_INTERSTITIAL_PLACEMENT; }
    static boolean cached(boolean reward) {
        if ((reward ? REWARD : INTER).expired(now())) { if (reward) rewardReady = false; else interReady = false; }
        return reward ? rewardReady : interReady;
    }
    static boolean cooling(boolean reward) { return INIT.cooling(now()) || (reward ? REWARD : INTER).cooling(now()); }
    static void warm(Activity a) {
        if (!BuildConfig.UNITY_ENABLED || !Ads.eligible(a) || showing) return;
        if (!ready) {
            int token = INIT.begin(now()); if (token == 0) return;
            MAIN.postDelayed(() -> { if (INIT.failed(token, now())) AdDiagnostics.record("sdk", "init", "failure", "TIMEOUT", ""); }, 45_000);
            try {
                UnityAds.initialize(a.getApplicationContext(), BuildConfig.UNITY_GAME_ID, BuildConfig.UNITY_TEST_MODE,
                    new IUnityAdsInitializationListener() {
                        public void onInitializationComplete() { MAIN.post(() -> {
                            if (!INIT.accepts(token)) return;
                            if (!UnityPrivacy.applyInitialized()) { INIT.failed(token, now()); return; }
                            if (!INIT.loaded(token, now())) return;
                            ready = true;
                            AdDiagnostics.record("sdk", "init", "success", "INITIALIZED", "");
                            Log.i(Ads.TAG, "UnityDirect initialized; testMode=" + BuildConfig.UNITY_TEST_MODE);
                            Ads.onResume(CineAmitApp.foreground());
                        }); }
                        public void onInitializationFailed(UnityAds.UnityAdsInitializationError error, String message) {
                            MAIN.post(() -> { if (INIT.failed(token, now())) { AdDiagnostics.record("sdk", "init", "failure", String.valueOf(error), ""); log("initialize", String.valueOf(error), message); } });
                        }
                    });
            } catch (RuntimeException e) { if (INIT.failed(token, now())) { AdDiagnostics.record("sdk", "init", "failure", e.getClass().getSimpleName(), ""); log("initialize", e.getClass().getSimpleName(), ""); } }
            return;
        }
        if (Ads.interOn()) load(false);
        if (Ads.rewardOn() && Sub.rewardProviderReady()) load(true);
    }
    private static void load(boolean reward) {
        if (cached(reward)) return;
        AdLoadState state = reward ? REWARD : INTER;
        int token = state.begin(now()); if (token == 0) return;
        MAIN.postDelayed(() -> { if (state.failed(token, now())) AdDiagnostics.record(reward ? "rewarded" : "interstitial", "load", "failure", "TIMEOUT", placement(reward)); }, 45_000);
        try {
            UnityAds.load(placement(reward), new IUnityAdsLoadListener() {
                public void onUnityAdsAdLoaded(String id) { MAIN.post(() -> {
                    if (!placement(reward).equals(id) || !state.loaded(token, now())) return;
                    if (reward) rewardReady = true; else interReady = true;
                    AdDiagnostics.record(reward ? "rewarded" : "interstitial", "load", "success", "LOADED", placement(reward));
                    Log.i(Ads.TAG, "UnityDirect " + (reward ? "rewarded" : "interstitial") + " loaded");
                }); }
                public void onUnityAdsFailedToLoad(String id, UnityAds.UnityAdsLoadError error, String message) {
                    MAIN.post(() -> { if (state.failed(token, now())) { AdDiagnostics.record(reward ? "rewarded" : "interstitial", "load", "failure", String.valueOf(error), placement(reward)); log("load", String.valueOf(error), message); } });
                }
            });
        } catch (RuntimeException e) { if (state.failed(token, now())) { AdDiagnostics.record(reward ? "rewarded" : "interstitial", "load", "failure", e.getClass().getSimpleName(), placement(reward)); log("load", e.getClass().getSimpleName(), ""); } }
    }
    static void show(Activity a, boolean reward, String sid, Runnable earned, java.util.function.Consumer<Boolean> finished) {
        if (showing || !Ads.eligibleForShow(a) || !cached(reward)) { finished.accept(false); return; }
        try {
            if (reward && (sid == null || !sid.matches("[1-9][0-9]{0,14}\\.[a-f0-9]{32}"))) { finished.accept(false); return; }
            // Server ID is process-global SDK metadata: never carry a reward nonce into an interstitial.
            PlayerMetaData player = new PlayerMetaData(a); player.setServerId(reward ? sid : ""); player.commit();
        } catch (RuntimeException e) { finished.accept(false); return; }
        if (reward) rewardReady = false; else interReady = false;
        showing = true;
        AtomicBoolean ended = new AtomicBoolean();
        java.util.function.Consumer<Boolean> end = started -> {
            if (!ended.compareAndSet(false, true)) return;
            showing = false;
            try { PlayerMetaData clear = new PlayerMetaData(CineAmitApp.get()); clear.setServerId(""); clear.commit(); }
            catch (RuntimeException ignored) { Log.w(Ads.TAG, "UnityDirect server ID cleanup unavailable"); }
            finished.accept(started);
        };
        try {
            UnityAds.show(a, placement(reward), new IUnityAdsShowListener() {
                public void onUnityAdsShowFailure(String id, UnityAds.UnityAdsShowError error, String message) {
                    MAIN.post(() -> { AdDiagnostics.record(reward ? "rewarded" : "interstitial", "show", "failure", String.valueOf(error), placement(reward)); log("show", String.valueOf(error), message); end.accept(true); });
                }
                public void onUnityAdsShowStart(String id) { AdDiagnostics.record(reward ? "rewarded" : "interstitial", "show", "started", "STARTED", placement(reward)); }
                public void onUnityAdsShowClick(String id) {}
                public void onUnityAdsShowComplete(String id, UnityAds.UnityAdsShowCompletionState completion) {
                    MAIN.post(() -> {
                        if (ended.get()) return;
                        AdDiagnostics.record(reward ? "rewarded" : "interstitial", "show", completion == UnityAds.UnityAdsShowCompletionState.COMPLETED ? "completed" : "skipped", String.valueOf(completion), placement(reward));
                        try {
                            if (reward && completion == UnityAds.UnityAdsShowCompletionState.COMPLETED && earned != null) earned.run();
                        } catch (RuntimeException e) { log("completion notification", e.getClass().getSimpleName(), ""); }
                        finally { end.accept(true); }
                    });
                }
            });
        } catch (RuntimeException e) { AdDiagnostics.record(reward ? "rewarded" : "interstitial", "show", "failure", e.getClass().getSimpleName(), placement(reward)); log("show", e.getClass().getSimpleName(), ""); end.accept(true); }
    }
    static void clear() { interReady = false; rewardReady = false; INTER.reset(); REWARD.reset(); }
    static void log(String where, String code, String message) {
        String safe = message == null ? "" : message.replaceAll("https?://\\S+", "[url]")
            .replaceAll("[\\r\\n\\t]", " ").replaceAll("(?i)(sid|ticket|token|hmac|adMarkup|objectId)[=:][^ ,;]+", "$1=[redacted]");
        // Error category only: provider messages can embed bid/reward payloads. Never log those payloads.
        Log.w(Ads.TAG, "UnityDirect " + where + " error=" + code
            + (safe.toLowerCase(java.util.Locale.ROOT).contains("admarkup") ? "; bidding placement requires real auction markup; direct load cannot fabricate it" : ""));
    }
}
