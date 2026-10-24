package in.cineamit.app;

import android.content.Context;
import android.util.Log;
import com.unity3d.ads.UnityAds;
import com.unity3d.ads.metadata.MetaData;

/** Contextual-only policy. Never translate a previous provider/CMP state into a Unity grant. */
final class UnityPrivacy {
    private UnityPrivacy() {}

    static boolean prepare(Context context) {
        if (context == null) return false;
        try {
            // Restrictive legacy metadata before initialization, including an upgraded installation.
            MetaData gdpr = new MetaData(context.getApplicationContext());
            if (!gdpr.set("gdpr.consent", false)) return false;
            gdpr.commit();
            MetaData privacy = new MetaData(context.getApplicationContext());
            if (!privacy.set("privacy.consent", false)) return false;
            privacy.commit();
            return !UnityDirect.initialized() || applyInitialized();
        } catch (RuntimeException error) {
            Log.w(Ads.TAG, "Unity contextual privacy preparation unavailable; requests blocked");
            return false;
        }
    }

    /** Unity 4.21 public privacy APIs: apply after initialization and before ANY ad load. */
    static boolean applyInitialized() {
        try {
            UnityAds.setUserConsent(false);
            UnityAds.setUserOptOut(true);
            UnityAds.setNonBehavioral(true);
            return true;
        } catch (RuntimeException error) {
            Log.w(Ads.TAG, "Unity contextual privacy API unavailable; requests blocked");
            return false;
        }
    }
}
