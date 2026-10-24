package in.cineamit.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import java.io.IOException;
import java.lang.ref.WeakReference;
import java.util.Locale;

/** Local positive evidence only. Offline, DNS errors, no-fill and ad-load errors are NOT evidence. */
public final class AccessGate {
    public enum Reason { NONE, VPN, AD_BLOCKING_DNS }
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static WeakReference<Activity> owner = new WeakReference<>(null);
    private static boolean initialized, launching;
    private static volatile Reason cached = Reason.NONE;
    private static final Runnable TICK = new Runnable() {
        @Override public void run() {
            Activity a = owner.get();
            if (!Io.alive(a)) return;
            refresh();
            if (a == owner.get()) MAIN.postDelayed(this, 1500);
        }
    };
    private AccessGate() {}

    static boolean filteringDns(String name) {
        if (name == null) return false;
        String host = name.toLowerCase(Locale.ROOT).replaceAll("\\.$", "");
        // Only the published filtering public services, NOT unfiltered/custom NextDNS profiles.
        return host.equals("dns.adguard-dns.com") || host.equals("family.adguard-dns.com");
    }

    static Reason inspect(ConnectivityManager cm) {
        if (cm == null) return Reason.NONE;
        try {
            Network[] networks = cm.getAllNetworks();
            if (networks != null) for (Network n : networks) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(n);
                if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return Reason.VPN;
            }
            Network active = cm.getActiveNetwork();
            NetworkCapabilities caps = active == null ? null : cm.getNetworkCapabilities(active);
            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return Reason.VPN;
            if (Build.VERSION.SDK_INT >= 28 && active != null) {
                LinkProperties lp = cm.getLinkProperties(active);
                if (lp != null && lp.isPrivateDnsActive() && filteringDns(lp.getPrivateDnsServerName()))
                    return Reason.AD_BLOCKING_DNS;
            }
        } catch (RuntimeException unavailable) { /* Unknown is not a positive detection. */ }
        return Reason.NONE;
    }

    public static Reason reason() {
        Context app = CineAmitApp.get();
        try { cached = app == null ? Reason.NONE : inspect((ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE)); }
        catch (RuntimeException unavailable) { cached = Reason.NONE; }
        return cached;
    }
    public static boolean blocked() { return reason() != Reason.NONE; }
    public static boolean cachedBlocked() { return cached != Reason.NONE; }
    public static final class Restricted extends IOException {
        public Restricted() { super("Disable VPN or filtering DNS to use CineAmit."); }
    }
    public static void requireAllowed() throws IOException { if (blocked()) throw new Restricted(); }

    public static void init(Context context) {
        if (initialized || context == null) return;
        initialized = true;
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { MAIN.post(AccessGate::refresh); }
                @Override public void onLost(Network n) { MAIN.post(AccessGate::refresh); }
                @Override public void onCapabilitiesChanged(Network n, NetworkCapabilities c) { MAIN.post(AccessGate::refresh); }
                @Override public void onLinkPropertiesChanged(Network n, LinkProperties p) { MAIN.post(AccessGate::refresh); }
            });
        } catch (RuntimeException unavailable) { /* Foreground polling still works. */ }
        reason();
    }

    /** Returns true when normal app chrome/bootstrap must not run. SDK Activities are never hijacked. */
    static boolean resumed(Activity activity) {
        if (!(activity instanceof AccessBlockedActivity) && !AppScreens.isOwned(activity)) return false;
        owner = new WeakReference<>(activity);
        MAIN.removeCallbacks(TICK);
        launching = false;
        refresh();
        MAIN.postDelayed(TICK, 1500);
        return activity instanceof AccessBlockedActivity || cached != Reason.NONE;
    }
    static void paused(Activity activity) {
        if (owner.get() != activity) return;
        MAIN.removeCallbacks(TICK);
        if (Build.VERSION.SDK_INT >= 24 && activity.isInPictureInPictureMode()) MAIN.postDelayed(TICK, 1500);
        else owner.clear();
    }
    static void pictureInPictureChanged(Activity activity, boolean pip) {
        if (!AppScreens.isOwned(activity)) return;
        if (pip) {
            owner = new WeakReference<>(activity);
            MAIN.removeCallbacks(TICK);
            refresh();
            MAIN.postDelayed(TICK, 1500);
        } else if (owner.get() == activity && CineAmitApp.foreground() != activity) {
            MAIN.removeCallbacks(TICK); owner.clear();
        }
    }
    static void destroyed(Activity activity) { if (owner.get() == activity) { MAIN.removeCallbacks(TICK); owner.clear(); launching = false; } }

    public static void refresh() {
        if (Looper.myLooper() != Looper.getMainLooper()) { MAIN.post(AccessGate::refresh); return; }
        Reason current = reason();
        Activity a = owner.get();
        if (!Io.alive(a)) return;
        if (a instanceof AccessBlockedActivity) {
            if (current == Reason.NONE) {
                // Blocked startup requests need a fresh bootstrap, not a permanently empty screen.
                // This resets navigation only: account, downloads and pending rewards stay intact.
                a.startActivity(new Intent(a, SplashActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
                a.finish();
            }
            else ((AccessBlockedActivity) a).render(current);
            return;
        }
        if (current == Reason.NONE || launching || Ads.isFullScreenShowing()) return;
        // Only app-owned foreground/PiP screens. Never start an Activity over a browser/SDK/background app.
        boolean pip = Build.VERSION.SDK_INT >= 24 && a.isInPictureInPictureMode();
        if (!AppScreens.isOwned(a) || (!pip && a != CineAmitApp.foreground())) return;
        launching = true;
        Ads.clearCachedAds();
        try {
            a.startActivity(new Intent(a, AccessBlockedActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            // Release embedded/PiP media, not merely an overlay while audio keeps playing.
            if (a instanceof PlayerActivity || a instanceof WatchActivity || a instanceof ReelsActivity || a instanceof DownloadWebActivity) a.finish();
        } catch (RuntimeException unavailable) { launching = false; }
    }
}
