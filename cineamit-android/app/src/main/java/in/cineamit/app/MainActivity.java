package in.cineamit.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;
import androidx.fragment.app.FragmentTransaction;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.AppUser;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.ui.AccountFragment;
import in.cineamit.app.ui.HomeFragment;
import in.cineamit.app.ui.IslandNav;
import in.cineamit.app.ui.SettingsFragment;
import in.cineamit.app.ui.Ui;
import in.cineamit.app.ui.WatchlistFragment;

public class MainActivity extends AppCompatActivity {
    private HomeFragment home;
    private WatchlistFragment watchlist;
    private AccountFragment account;
    private SettingsFragment settings;
    private String tab = "home";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        FragmentManager fm = getSupportFragmentManager();
        if (savedInstanceState != null) {
            home = (HomeFragment) fm.findFragmentByTag("home");
            watchlist = (WatchlistFragment) fm.findFragmentByTag("watchlist");
            account = (AccountFragment) fm.findFragmentByTag("more");
            settings = (SettingsFragment) fm.findFragmentByTag("settings");
            tab = savedInstanceState.getString("tab", "home");
        }
        if (home == null) home = new HomeFragment();
        if (watchlist == null) watchlist = new WatchlistFragment();
        if (account == null) account = new AccountFragment();
        if (settings == null) settings = new SettingsFragment();

        View llHome = findViewById(R.id.llHome);
        if (llHome != null) llHome.setOnClickListener(v -> go("home"));
        View llWatch = findViewById(R.id.llWatchlist);
        if (llWatch != null) llWatch.setOnClickListener(v -> go("watchlist"));
        View llMenu = findViewById(R.id.llMenu);
        if (llMenu != null) llMenu.setOnClickListener(v -> openMenu());
        View llAcc = findViewById(R.id.llAccount);
        if (llAcc != null) llAcc.setOnClickListener(v -> go("more"));
        View llSet = findViewById(R.id.llSetting);
        if (llSet != null) llSet.setOnClickListener(v -> go("settings"));

        String start = tab;
        if (savedInstanceState == null) {
            start = "home";
            if (getIntent() != null && getIntent().getStringExtra("tab") != null) {
                start = getIntent().getStringExtra("tab");
            }
        }
        go(start);
            Io.run(this, Api::bootstrap, json -> {
                Api.applyMeta(json);
                Ads.attachBanner(this);
                AppUpdate.checkLaunch(this, json);
            if (Session.user != null) {
                Io.run(this, () -> Api.walletSync(Sub.localPayload()), wallet -> {
                    Sub.applyRemote(wallet);
                    if (account.isAdded()) account.refresh();
                }, err -> {});
            }
            if (account.isAdded()) account.refresh();
        }, e -> {});
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getStringExtra("tab") != null) go(intent.getStringExtra("tab"));
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putString("tab", tab);
    }

    public String currentTab() {
        return tab;
    }

    public void scrollHomeTop() {
        if (home != null) home.scrollToTop();
    }

    public void go(String dest) {
        if (dest == null) dest = "home";
        if (!"watchlist".equals(dest) && !"more".equals(dest) && !"settings".equals(dest)) dest = "home";
        boolean changed = !dest.equals(tab);
        tab = dest;
        Fragment target;
        switch (dest) {
            case "watchlist": target = watchlist; break;
            case "more": target = account; break;
            case "settings": target = settings; break;
            default: target = home; break;
        }
        FragmentManager fm = getSupportFragmentManager();
        FragmentTransaction tx = fm.beginTransaction()
                .setCustomAnimations(R.anim.cine_fade_in, R.anim.cine_fade_out);
        Fragment[] all = {home, watchlist, account, settings};
        for (Fragment x : all) {
            if (x == target) {
                if (!x.isAdded()) tx.add(R.id.Container, x, tab);
                else tx.show(x);
            } else if (x.isAdded()) {
                tx.hide(x);
            }
        }
        tx.commitAllowingStateLoss();
        fm.executePendingTransactions();
        paintTabs();
        paintToolbar();
        IslandNav.bind(this);
        if ("watchlist".equals(tab)) watchlist.reload();
        if ("more".equals(tab)) account.refresh();
        if (changed && hasWindowFocus()) Ads.onNavigate(this);
    }

    private void paintToolbar() {
        View tb = findViewById(R.id.toolbar_main);
        View bar = findViewById(R.id.bottomBar);
        if (tb != null) tb.setVisibility(View.GONE);
        if (bar != null) bar.setVisibility(View.GONE);
    }

    private void paintTabs() {
        View bar = findViewById(R.id.bottomBar);
        if (bar == null || bar.getVisibility() != View.VISIBLE) return;
        colorTab(R.id.ivHome, R.id.tvHome, "home".equals(tab));
        colorTab(R.id.ivWatchlist, R.id.tvWatchlist, "watchlist".equals(tab));
        colorTab(R.id.ivAccount, R.id.tvAccount, "more".equals(tab));
        colorTab(R.id.ivSetting, R.id.tvSetting, "settings".equals(tab));
    }

    private void colorTab(int icon, int text, boolean on) {
        int c = on ? Ui.ACCENT : Ui.BOTTOM;
        ImageView iv = findViewById(icon);
        TextView tv = findViewById(text);
        if (iv != null) Ui.tint(iv, c);
        if (tv != null) tv.setTextColor(c);
    }

    public void openMenu() {
        IslandNav.openMenu(this);
    }

    public AppUser user() {
        return Session.user;
    }

    public void setUser(AppUser u) {
        Session.user = u;
    }

    public static void openDetails(android.content.Context ctx, String type, long id) {
        ctx.startActivity(new Intent(ctx, DetailsActivity.class)
                .putExtra("type", type)
                .putExtra("id", id));
    }
}
