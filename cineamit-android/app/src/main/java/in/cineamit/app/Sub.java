package in.cineamit.app;

import android.content.SharedPreferences;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import in.cineamit.app.data.Models.Session;

/** Points wallet + subscription. Rates come from admin; wallet syncs with server. */
public final class Sub {
    public static final String FREE = "free";
    public static final String TRIAL = "trial";
    public static final String MONTHLY = "monthly";
    public static final String YEARLY = "yearly";
    public static final int COST_MONTHLY = 500;
    public static final int COST_YEARLY = 4500;
    public static final int AD_POINTS = 50;

    private Sub() {}

    public static int adPoints() {
        return Math.max(1, prefs().getInt("eco_ad_pts", AD_POINTS));
    }

    public static int costMonthly() {
        return Math.max(0, prefs().getInt("eco_m", COST_MONTHLY));
    }

    public static int costYearly() {
        return Math.max(0, prefs().getInt("eco_y", COST_YEARLY));
    }

    public static int cost(String type) {
        if (YEARLY.equals(type)) return costYearly();
        if (MONTHLY.equals(type)) return costMonthly();
        return 0;
    }

    public static boolean adsMaster() {
        return prefs().getBoolean("eco_ads", true);
    }

    public static boolean adsBanner() {
        return adsMaster() && prefs().getBoolean("eco_banner", true);
    }

    public static boolean adsInterstitial() {
        return adsMaster() && prefs().getBoolean("eco_inter", true);
    }

    public static boolean adsDiagnostics() { return prefs().getBoolean("eco_ad_diagnostics", false); }
    public static int rewardDailyCap() { return prefs().getInt("eco_reward_daily_cap", 1000); }
    public static int rewardCooldownSec() { return prefs().getInt("eco_reward_cooldown", 60); }
    public static boolean rewardProviderReady() {
        return prefs().getBoolean("eco_reward_unity", false);
    }
    public static boolean adsRewarded() {
        return adsMaster() && prefs().getBoolean("eco_reward", true)
                && prefs().getBoolean("eco_reward_verify", false);
    }

    public static boolean adsInterEveryPage() {
        return adsInterstitial() && prefs().getBoolean("eco_inter_every", true);
    }

    public static boolean adsRewardEveryPage() {
        return adsRewarded() && prefs().getBoolean("eco_reward_every", false);
    }

    public static boolean adsHomeBanners() {
        return adsBanner() && prefs().getBoolean("eco_home_banners", true);
    }

    public static boolean adsBannerTop() {
        return adsBanner() && prefs().getBoolean("eco_banner_top", true);
    }

    public static long interGapMs() {
        int sec = Math.max(0, prefs().getInt("eco_gap", 6));
        return Math.max(2000L, sec * 1000L);
    }

    public static int points() {
        return Math.max(0, prefs().getInt(k("pts"), 0));
    }

    public static int addPoints(int n) {
        if (n <= 0) return points();
        int next = points() + n;
        prefs().edit().putInt(k("pts"), next).apply();
        return next;
    }

    public static boolean spend(int n) {
        if (n <= 0) return true;
        int have = points();
        if (have < n) return false;
        prefs().edit().putInt(k("pts"), have - n).apply();
        return true;
    }

    public static String plan() {
        if (!isPremium()) return FREE;
        String p = prefs().getString(k("plan"), FREE);
        return p == null || p.isEmpty() ? FREE : p;
    }

    public static boolean isPremium() {
        return prefs().getLong(k("until"), 0L) > System.currentTimeMillis();
    }

    public static int trialDays() {
        return Math.max(1, prefs().getInt("eco_trial_days", 14));
    }

    public static int daysMonthly() {
        return Math.max(1, prefs().getInt("eco_days_m", 30));
    }

    public static int daysYearly() {
        return Math.max(1, prefs().getInt("eco_days_y", 365));
    }

    public static boolean trialEnabled() {
        return prefs().getBoolean("eco_trial_on", true);
    }

    public static boolean monthlyEnabled() {
        return prefs().getBoolean("eco_m_on", true);
    }

    public static boolean yearlyEnabled() {
        return prefs().getBoolean("eco_y_on", true);
    }

    public static String ecoLabel(String type, String fallback) {
        String v = prefs().getString("eco_label_" + type, "");
        return v == null || v.trim().isEmpty() ? fallback : v.trim();
    }

    public static String ecoBlurb(String type, String fallback) {
        String v = prefs().getString("eco_blurb_" + type, "");
        return v == null || v.trim().isEmpty() ? fallback : v.trim();
    }

    public static boolean trialUsed() {
        return prefs().getBoolean(k("trial_used"), false);
    }

    public static boolean trialAvailable() {
        return Session.user != null && trialEnabled() && !isPremium() && !trialUsed();
    }

    public static String label() {
        if (!isPremium()) return "Free";
        if (TRIAL.equals(plan())) return "Free Trial";
        if (YEARLY.equals(plan())) return "Premium Yearly";
        return "Premium Monthly";
    }

    public static String expiryText() {
        long until = prefs().getLong(k("until"), 0L);
        if (until <= System.currentTimeMillis()) return "";
        return new SimpleDateFormat("d MMM yyyy", Locale.US).format(new Date(until));
    }

    public static boolean redeem(String type) {
        int c = cost(type);
        if (c <= 0) {
            clear();
            return true;
        }
        if (!spend(c)) return false;
        activate(type);
        return true;
    }

    public static void activate(String type) {
        String t = type == null ? FREE : type;
        long now = System.currentTimeMillis();
        long until = 0L;
        if (MONTHLY.equals(t)) until = now + daysMonthly() * 24L * 60 * 60 * 1000;
        else if (YEARLY.equals(t)) until = now + daysYearly() * 24L * 60 * 60 * 1000;
        else if (TRIAL.equals(t)) until = now + trialDays() * 24L * 60 * 60 * 1000;
        else t = FREE;
        prefs().edit().putString(k("plan"), t).putLong(k("until"), until).apply();
    }

    public static void clear() {
        prefs().edit().putString(k("plan"), FREE).putLong(k("until"), 0L).apply();
    }

    public static void applyRemote(JSONObject json) {
        if (json == null) return;
        JSONObject eco = json.optJSONObject("economy");
        if (eco == null && json.has("ads_enabled")) eco = json;
        if (eco != null) {
            prefs().edit()
                    .putBoolean("eco_ads", eco.optBoolean("ads_enabled", true))
                    .putBoolean("eco_ad_diagnostics", eco.optBoolean("ads_diagnostics", false))
                    .putInt("eco_reward_daily_cap", Math.max(0, eco.optInt("reward_daily_cap", 1000)))
                    .putInt("eco_reward_cooldown", Math.max(0, eco.optInt("reward_cooldown_sec", 60)))
                    .putBoolean("eco_banner", eco.optBoolean("ads_banner", true))
                    .putBoolean("eco_inter", eco.optBoolean("ads_interstitial", true))
                    .putBoolean("eco_reward", eco.optBoolean("ads_rewarded", true))
                    .putBoolean("eco_reward_verify", eco.optBoolean("reward_verification_unity", false))
                    .putBoolean("eco_reward_unity", eco.optBoolean("reward_verification_unity", false))
                    .putBoolean("eco_inter_every", eco.optBoolean("ads_inter_every", true))
                    .putBoolean("eco_reward_every", eco.optBoolean("ads_reward_every", false))
                    .putBoolean("eco_home_banners", eco.optBoolean("ads_home_banners", true))
                    .putBoolean("eco_banner_top", eco.optBoolean("ads_banner_top", true))
                    .putInt("eco_gap", Math.max(0, eco.optInt("inter_gap_sec", 6)))
                    .putInt("eco_ad_pts", Math.max(1, eco.optInt("ad_points", AD_POINTS)))
                    .putInt("eco_m", Math.max(0, eco.optInt("cost_monthly", COST_MONTHLY)))
                    .putInt("eco_y", Math.max(0, eco.optInt("cost_yearly", COST_YEARLY)))
                    .putInt("eco_trial_days", Math.max(1, eco.optInt("trial_days", 14)))
                    .putInt("eco_days_m", Math.max(1, eco.optInt("days_monthly", 30)))
                    .putInt("eco_days_y", Math.max(1, eco.optInt("days_yearly", 365)))
                    .putBoolean("eco_trial_on", eco.optBoolean("trial_enabled", true))
                    .putBoolean("eco_m_on", eco.optBoolean("monthly_enabled", true))
                    .putBoolean("eco_y_on", eco.optBoolean("yearly_enabled", true))
                    .putString("eco_label_trial", eco.optString("label_trial", ""))
                    .putString("eco_blurb_trial", eco.optString("blurb_trial", ""))
                    .putString("eco_label_monthly", eco.optString("label_monthly", ""))
                    .putString("eco_blurb_monthly", eco.optString("blurb_monthly", ""))
                    .putString("eco_label_yearly", eco.optString("label_yearly", ""))
                    .putString("eco_blurb_yearly", eco.optString("blurb_yearly", ""))
                    .apply();
        }
        JSONObject w = json.optJSONObject("wallet");
        if (w != null && w.optBoolean("seeded", false)) applyWallet(w);
    }

    public static void applyWallet(JSONObject w) {
        if (w == null || Session.user == null) return;
        String plan = w.optString("plan", FREE);
        if (plan == null || plan.isEmpty()) plan = FREE;
        long until = w.optLong("until", 0L);
        prefs().edit()
                .putInt(k("pts"), Math.max(0, w.optInt("points", 0)))
                .putString(k("plan"), plan)
                .putLong(k("until"), until)
                .putBoolean(k("trial_used"), w.optBoolean("trial_used", false))
                .apply();
    }

    public static JSONObject localPayload() {
        JSONObject o = new JSONObject();
        try {
            o.put("points", points());
            o.put("plan", plan());
            o.put("until", prefs().getLong(k("until"), 0L));
        } catch (Exception ignored) {}
        return o;
    }

    private static String k(String name) {
        long id = Session.user != null ? Session.user.id : 0L;
        return "sub_" + name + "_" + id;
    }

    private static SharedPreferences prefs() {
        return CineAmitApp.prefs();
    }
}
