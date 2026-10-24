package in.cineamit.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

/** Contextual-only SDK policy. No startup dialog or local ad-delivery toggle. */
final class AdsPrivacy {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static boolean prepared;
    private AdsPrivacy() {}

    static boolean canRequest() { return prepared; }

    static void gather(Activity activity, Runnable ready) {
        if (Looper.myLooper() != Looper.getMainLooper()) { MAIN.post(() -> gather(activity, ready)); return; }
        if (!current(activity) || !AppScreens.canHostAds(activity) || !Ads.enabled()) return;
        // Default ad delivery is on, but NEVER fabricate a personalized-consent grant.
        prepared = UnityPrivacy.prepare(activity);
        if (!prepared) { Ads.clearCachedAds(); return; }
        if (ready != null && current(activity)) ready.run();
    }

    static void showOptions(Activity activity) {
        if (Looper.myLooper() != Looper.getMainLooper()) { MAIN.post(() -> showOptions(activity)); return; }
        if (!current(activity) || Ads.isFullScreenShowing()) return;
        Ads.clearCachedAds(); // Cancel any pending show before leaving for the policy browser.
        // Information is available on demand, without interrupting launch or offering ad switches.
        try { activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://unity.com/legal/privacy-policy"))); }
        catch (RuntimeException error) {
            Toast.makeText(activity, "Open unity.com/legal/privacy-policy in your browser.", Toast.LENGTH_LONG).show();
        }
    }

    private static boolean current(Activity activity) {
        return Io.alive(activity) && activity == CineAmitApp.foreground() && AppScreens.isOwned(activity);
    }
}
