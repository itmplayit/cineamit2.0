package in.cineamit.app;

import in.cineamit.app.data.Models;

/** Sticky last authenticated Kids state also protects notification/process-restored entry.
 * Signing out does not turn Kids offline restrictions into a guest bypass.
 */
public final class OfflinePolicy {
    private OfflinePolicy() {}
    public static boolean restricted() {
        return (Models.Session.user != null && Models.Session.user.is_kids)
                || CineAmitApp.prefs().getBoolean("offline_kids_restricted_v1", false);
    }
    public static void record(Models.AppUser user) {
        if (user != null && user.id > 0) CineAmitApp.prefs().edit()
                .putBoolean("offline_kids_restricted_v1", user.is_kids).commit();
    }
    public static boolean allows(boolean serverVerifiedKidsSafe) {
        return !restricted() || serverVerifiedKidsSafe;
    }
}
