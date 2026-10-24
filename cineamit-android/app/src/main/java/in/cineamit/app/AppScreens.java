package in.cineamit.app;

import android.app.Activity;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Explicit app-owned Activity allowlist. SDK ad/consent/browser Activities never host app chrome. */
public final class AppScreens {
    private static final Set<Class<?>> OWNED = new HashSet<>(Arrays.asList(
            SplashActivity.class, LoginActivity.class, ProfilesActivity.class, MainActivity.class,
            DetailsActivity.class, DownloadsActivity.class, DownloadWebActivity.class,
            SearchActivity.class, BrowseActivity.class, CatalogActivity.class, LiveActivity.class,
            VodSeriesActivity.class, InfoActivity.class, PlansActivity.class, ListActivity.class,
            PageActivity.class, ReelsActivity.class, WatchActivity.class, PlayerActivity.class));
    private AppScreens() {}
    public static boolean isOwned(Activity activity) {
        return activity != null && OWNED.contains(activity.getClass());
    }
    public static boolean canHostAds(Activity a) {
        return isOwned(a) && !(a instanceof SplashActivity || a instanceof LoginActivity
                || a instanceof ProfilesActivity || a instanceof PlayerActivity || a instanceof WatchActivity
                || a instanceof DownloadWebActivity || a instanceof ReelsActivity || a instanceof PageActivity);
    }
}
