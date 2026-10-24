package in.cineamit.app;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;

import java.lang.ref.WeakReference;
import java.net.CookieManager;
import java.net.CookiePolicy;

import in.cineamit.app.data.Downloads;
import in.cineamit.app.ui.IslandNav;

public class CineAmitApp extends Application {
    private static CineAmitApp instance;
    private static WeakReference<Activity> foregroundRef;
    public static final CookieManager cookieManager = new CookieManager();

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        cookieManager.setCookiePolicy(CookiePolicy.ACCEPT_ALL);
        AccessGate.init(this);
        Downloads.init();
        Ads.init(this);
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override public void onActivityCreated(Activity activity, Bundle savedInstanceState) {
                if (AppScreens.isOwned(activity) && savedInstanceState == null) Ads.markFresh(activity);
            }
            @Override public void onActivityStarted(Activity activity) {}
            @Override public void onActivityResumed(Activity activity) {
                if (activity instanceof AccessBlockedActivity) { foregroundRef = null; AccessGate.resumed(activity); return; }
                if (!AppScreens.isOwned(activity)) { foregroundRef = null; return; }
                foregroundRef = new WeakReference<>(activity);
                if (AccessGate.resumed(activity)) return;
                IslandNav.attach(activity);
                Ads.onResume(activity);
                Ads.consumeFreshOpen(activity);
                RewardClaims.resume();
                Downloads.resumeQueue();
                Analytics.appOpen();
                Analytics.screen(activity);
            }
            @Override public void onActivityPaused(Activity activity) {
                AccessGate.paused(activity);
                if (!AppScreens.isOwned(activity)) return;
                Ads.onPause(activity);
                Activity cur = foreground();
                if (cur == activity) foregroundRef = null;
            }
            @Override public void onActivityStopped(Activity activity) {}
            @Override public void onActivitySaveInstanceState(Activity activity, Bundle outState) {}
            @Override public void onActivityDestroyed(Activity activity) {
                AccessGate.destroyed(activity);
                if (AppScreens.isOwned(activity)) { Ads.dropFresh(activity); RewardClaims.detach(activity); }
            }
        });
    }

    public static CineAmitApp get() {
        return instance;
    }

    public static Activity foreground() {
        Activity a = foregroundRef == null ? null : foregroundRef.get();
        if (a == null || a.isFinishing()) return null;
        if (Build.VERSION.SDK_INT >= 17 && a.isDestroyed()) return null;
        return a;
    }

    public static android.content.SharedPreferences prefs() {
        return instance.getSharedPreferences("cineamit", Context.MODE_PRIVATE);
    }

    public static boolean isEmulator() {
        String finger = Build.FINGERPRINT;
        String model = Build.MODEL;
        String hardware = Build.HARDWARE;
        String product = Build.PRODUCT;
        String brand = Build.BRAND;
        String device = Build.DEVICE;
        return finger.startsWith("generic")
                || finger.toLowerCase().contains("emulator")
                || model.toLowerCase().contains("emulator")
                || model.contains("Android SDK")
                || hardware.contains("ranchu")
                || hardware.contains("goldfish")
                || product.contains("sdk")
                || product.contains("emulator")
                || (brand.startsWith("generic") && device.startsWith("generic"));
    }

    public static String normalizeBaseUrl(String raw) {
        return normalizeBaseUrl(raw, true);
    }

    public static String normalizeBaseUrl(String raw, boolean rewriteLoopback) {
        if (raw == null) return "";
        String s = raw.trim();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        if (s.isEmpty()) return s;
        String low = s.toLowerCase();
        if (!low.startsWith("http://") && !low.startsWith("https://")) s = "https://" + s;
        if (rewriteLoopback && isEmulator()) {
            s = s.replaceAll("(?i)://localhost", "://10.0.2.2")
                    .replace("://127.0.0.1", "://10.0.2.2")
                    .replace("://[::1]", "://10.0.2.2");
        }
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    public static String baseUrl() {
        String saved = prefs().getString("base_url", null);
        if (saved != null && saved.toLowerCase().contains("your-domain")) {
            prefs().edit().remove("base_url").apply();
            saved = null;
        }
        String raw = (saved == null || saved.trim().isEmpty()) ? BuildConfig.DEFAULT_BASE_URL : saved.trim();
        return normalizeBaseUrl(raw);
    }

    public static void setBaseUrl(String url) {
        prefs().edit().putString("base_url", normalizeBaseUrl(url)).apply();
    }

    public static boolean isLoopbackUrl(String url) {
        String u = url == null ? "" : url.toLowerCase();
        return u.contains("://127.0.0.1") || u.contains("://localhost") || u.contains("://[::1]");
    }

    public static String friendlyNetError(Throwable e) {
        return friendlyNetError(e, baseUrl());
    }

    public static String friendlyNetError(Throwable e, String url) {
        boolean loopback = isLoopbackUrl(url);
        if (loopback && isEmulator()) {
            return "On emulator, 127.0.0.1 is the phone. Run Node on 0.0.0.0:3000.";
        }
        if (loopback) {
            return "On a phone, 127.0.0.1 is the phone itself. Put the phone and laptop on the same Wi‑Fi.";
        }
        if (url.toLowerCase().contains("your-domain")) {
            return "Could not connect to the server. Check your network.";
        }
        String msg = e == null || e.getMessage() == null ? "Network error" : e.getMessage();
        String m = msg.toLowerCase();
        if (m.contains("failed to connect") || m.contains("timeout") || m.contains("unable to resolve") || m.contains("econnrefused")) {
            return "Server not found. Check your network.";
        }
        return msg;
    }
}
