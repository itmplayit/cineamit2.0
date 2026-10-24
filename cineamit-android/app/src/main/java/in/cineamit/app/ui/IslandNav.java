package in.cineamit.app.ui;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.FrameLayout;
import android.widget.ImageView;

import in.cineamit.app.BrowseActivity;
import in.cineamit.app.LiveActivity;
import in.cineamit.app.LoginActivity;
import in.cineamit.app.MainActivity;
import in.cineamit.app.PageActivity;
import in.cineamit.app.PlayerActivity;
import in.cineamit.app.ProfilesActivity;
import in.cineamit.app.R;
import in.cineamit.app.SplashActivity;
import in.cineamit.app.WatchActivity;

public final class IslandNav {
    private IslandNav() {}

    public static void attach(Activity a) {
        if (!in.cineamit.app.AppScreens.isOwned(a) || a.isFinishing()) return;
        if (a instanceof SplashActivity || a instanceof PlayerActivity || a instanceof WatchActivity
                || a instanceof LoginActivity || a instanceof PageActivity
                || a instanceof ProfilesActivity
                || a instanceof in.cineamit.app.ReelsActivity
                || a instanceof in.cineamit.app.DownloadWebActivity
                || a instanceof in.cineamit.app.PlansActivity
                || a instanceof in.cineamit.app.DetailsActivity
                || a instanceof in.cineamit.app.LiveActivity
                || a instanceof in.cineamit.app.SearchActivity
                || a instanceof in.cineamit.app.CatalogActivity
                || a instanceof in.cineamit.app.VodSeriesActivity
                || a instanceof in.cineamit.app.InfoActivity) return;
        ViewGroup content = a.findViewById(android.R.id.content);
        if (content == null) return;
        if (a.findViewById(R.id.islandNav) == null) {
            View island = LayoutInflater.from(a).inflate(R.layout.layout_island_nav, content, false);
            float d = a.getResources().getDisplayMetrics().density;
            int h = Math.round(60 * d);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, h, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
            lp.bottomMargin = Math.round((Ui.widthDp(a) < 360 ? 12 : 16) * d);
            island.setElevation(18f * d);
            island.setClipToOutline(true);
            content.addView(island, lp);
            final int base = lp.bottomMargin;
            androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(island, (v, insets) -> {
                int nav = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars()).bottom;
                FrameLayout.LayoutParams p = (FrameLayout.LayoutParams) v.getLayoutParams();
                p.bottomMargin = base + nav + in.cineamit.app.Ads.bannerReservePx(a);
                v.setLayoutParams(p);
                return insets;
            });
            androidx.core.view.ViewCompat.requestApplyInsets(island);
            Motion.enterIsland(island);
        }
        bind(a);
    }

    public static void bind(Activity a) {
        View home = a.findViewById(R.id.islandHome);
        View plus = a.findViewById(R.id.islandPlus);
        View profile = a.findViewById(R.id.islandProfile);
        View dot = a.findViewById(R.id.islandHomeDot);
        if (home == null) return;
        Motion.press(slot(a, R.id.islandHomeSlot, home));
        Motion.press(slot(a, R.id.islandPlusSlot, plus));
        Motion.press(slot(a, R.id.islandProfileSlot, profile));
        boolean onHome = a instanceof MainActivity && "home".equals(((MainActivity) a).currentTab());
        boolean onAccount = a instanceof MainActivity && "more".equals(((MainActivity) a).currentTab());
        if (dot != null) dot.setVisibility(View.GONE);
        paintTab(a, R.id.islandHomeOn, home, onHome);
        paintTab(a, R.id.islandPlusOn, plus, false);
        paintTab(a, R.id.islandProfileOn, profile, onAccount);
        View homeHit = a.findViewById(R.id.islandHomeSlot);
        (homeHit != null ? homeHit : home).setOnClickListener(v -> {
            if (a instanceof MainActivity) {
                MainActivity m = (MainActivity) a;
                if ("home".equals(m.currentTab())) m.scrollHomeTop();
                else m.go("home");
            } else {
                goMain(a, "home");
            }
        });
        View plusHit = a.findViewById(R.id.islandPlusSlot);
        View plusBtn = plusHit != null ? plusHit : plus;
        if (plusBtn != null) plusBtn.setOnClickListener(v -> openMenu(a));
        View profileHit = a.findViewById(R.id.islandProfileSlot);
        View profileBtn = profileHit != null ? profileHit : profile;
        if (profileBtn != null) profileBtn.setOnClickListener(v -> {
            if (a instanceof MainActivity) ((MainActivity) a).go("more");
            else goMain(a, "more");
        });
    }

    private static View slot(Activity a, int slotId, View fallback) {
        View s = a.findViewById(slotId);
        return s != null ? s : fallback;
    }

    private static void paintTab(Activity a, int onId, View icon, boolean on) {
        View glow = a.findViewById(onId);
        if (glow != null) glow.setVisibility(on ? View.VISIBLE : View.INVISIBLE);
        if (icon instanceof ImageView) Ui.tint((ImageView) icon, on ? 0xFFC4B5FD : 0xE6FFFFFF);
    }

    public static void goMain(Activity a, String tab) {
        a.startActivity(new Intent(a, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("tab", tab));
        if (!(a instanceof MainActivity)) a.finish();
    }

    public static void openMenu(Activity a) {
        Dialog menu = new Dialog(a, android.R.style.Theme_Translucent_NoTitleBar);
        menu.setContentView(R.layout.layout_menu_sheet);
        Window w = menu.getWindow();
        if (w != null) {
            w.setGravity(Gravity.BOTTOM);
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            w.setDimAmount(0.6f);
            w.setWindowAnimations(R.style.CineSheetAnim);
        }
        View movie = menu.findViewById(R.id.rlMovie);
        View show = menu.findViewById(R.id.rlShow);
        View anime = menu.findViewById(R.id.rlAnime);
        View sport = menu.findViewById(R.id.rlSport);
        View live = menu.findViewById(R.id.rlTV);
        if (movie != null) movie.setOnClickListener(v -> { menu.dismiss(); BrowseActivity.open(a, "movie", "Movies"); });
        if (show != null) show.setOnClickListener(v -> { menu.dismiss(); BrowseActivity.open(a, "tv", "Series"); });
        if (anime != null) anime.setOnClickListener(v -> { menu.dismiss(); BrowseActivity.open(a, "anime", "Anime"); });
        View reels = menu.findViewById(R.id.rlReels);
        if (reels != null) reels.setOnClickListener(v -> { menu.dismiss(); in.cineamit.app.ReelsActivity.open(a); });
        if (sport != null) sport.setOnClickListener(v -> { menu.dismiss(); LiveActivity.openSports(a); });
        if (live != null) live.setOnClickListener(v -> { menu.dismiss(); LiveActivity.open(a); });
        View surprise = menu.findViewById(R.id.rlSurprise);
        if (surprise != null) surprise.setOnClickListener(v -> { menu.dismiss(); PageActivity.open(a, "surprise"); });
        View mood = menu.findViewById(R.id.rlMood);
        if (mood != null) mood.setOnClickListener(v -> { menu.dismiss(); PageActivity.open(a, "mood"); });
        View watchlist = menu.findViewById(R.id.rlWatchlist);
        View downloads = menu.findViewById(R.id.rlDownloads);
        View settings = menu.findViewById(R.id.rlSettings);
        if (watchlist != null) watchlist.setOnClickListener(v -> {
            menu.dismiss();
            if (a instanceof MainActivity) ((MainActivity) a).go("watchlist");
            else goMain(a, "watchlist");
        });
        if (downloads != null) downloads.setOnClickListener(v -> {
            menu.dismiss();
            in.cineamit.app.DownloadsActivity.open(a);
        });
        if (settings != null) settings.setOnClickListener(v -> {
            menu.dismiss();
            if (a instanceof MainActivity) ((MainActivity) a).go("settings");
            else goMain(a, "settings");
        });
        View close = menu.findViewById(R.id.ivMenuClose);
        if (close != null) close.setOnClickListener(v -> menu.dismiss());
        for (int id : new int[]{R.id.rlMovie, R.id.rlShow, R.id.rlAnime, R.id.rlReels, R.id.rlSport, R.id.rlTV, R.id.rlSurprise, R.id.rlMood, R.id.rlWatchlist, R.id.rlDownloads, R.id.rlSettings}) {
            View row = menu.findViewById(id);
            if (row != null) Motion.press(row);
        }
        menu.show();
    }
}
