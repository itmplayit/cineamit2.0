package in.cineamit.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.PictureInPictureParams;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.core.widget.NestedScrollView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Downloads;
import in.cineamit.app.data.Models.AppUser;
import in.cineamit.app.data.Models.Episode;
import in.cineamit.app.data.Models.Season;
import in.cineamit.app.data.Models.Server;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.ui.Motion;
import in.cineamit.app.ui.Ui;

public class WatchActivity extends Activity {
    private static final String ENDED_JS =
            "(function(){try{"
                    + "function ping(){try{if(window.CineAmit)CineAmit.onEnded();}catch(e){}}"
                    + "function hook(v){if(!v||v._caEnd)return;v._caEnd=1;v.addEventListener('ended',ping);}"
                    + "document.querySelectorAll('video').forEach(hook);"
                    + "if(window.MutationObserver)new MutationObserver(function(){document.querySelectorAll('video').forEach(hook);})"
                    + ".observe(document.documentElement,{childList:true,subtree:true});"
                    + "window.addEventListener('message',function(ev){var d=ev&&ev.data;if(d==='video_ended'||(d&&d.event==='ended'))ping();});"
                    + "}catch(e){}})();";

    private String type = "movie";
    private long id;
    private String title = "";
    private int s = 1;
    private int e = 1;
    private int loadGen;
    private int embedGen;
    private int serverIndex;
    private boolean cinema;
    private boolean pipAttempt;
    private boolean inWatchlist;
    private boolean watchlistBusy;
    private boolean autoplay = true;
    private boolean autoplayArmed;
    private long embedAt;
    private List<Server> servers = new ArrayList<>();
    private List<Season> seasons = new ArrayList<>();
    private List<Episode> episodes = new ArrayList<>();
    private List<Episode> allEpisodes = new ArrayList<>();

    private WebView webView;
    private EmbedWebViewClient embedClient;
    private View chromeCustom;
    private WebChromeClient.CustomViewCallback chromeCallback;
    private FrameLayout playerHost;
    private FrameLayout fullscreenHost;
    private View watchPage;

    private String room = "";
    private long partyLastId;
    private boolean partyStarted;
    private boolean partyBusy;
    private final Handler partyHandler = new Handler(Looper.getMainLooper());
    private final Runnable partyTick = this::pollParty;

    public static void open(Context ctx, String type, long id, String title, int s, int e) {
        ctx.startActivity(new Intent(ctx, WatchActivity.class)
                .putExtra("type", type)
                .putExtra("id", id)
                .putExtra("title", title == null ? "" : title)
                .putExtra("s", s)
                .putExtra("e", e));
    }

    public final class PlayerBridge {
        private final int generation;
        PlayerBridge(int generation) { this.generation = generation; }
        @JavascriptInterface
        public void onEnded() {
            runOnUiThread(() -> {
                if (generation == embedGen && webView != null && Io.alive(WatchActivity.this)) maybeAutoplay();
            });
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_watch);
        watchPage = findViewById(R.id.watchPage);
        playerHost = findViewById(R.id.playerHost);
        fullscreenHost = findViewById(R.id.fullscreenHost);
        type = getIntent().getStringExtra("type");
        if (type == null || type.isEmpty()) type = "movie";
        id = getIntent().getLongExtra("id", 0);
        title = getIntent().getStringExtra("title");
        Analytics.watch(type, id);
        if (title == null) title = "";
        s = Math.max(1, getIntent().getIntExtra("s", 1));
        e = Math.max(1, getIntent().getIntExtra("e", 1));
        sizePlayerHost();
        findViewById(R.id.btnBack).setOnClickListener(v -> finish());
        Motion.press(findViewById(R.id.btnBack));
        Motion.press(findViewById(R.id.btnPrev));
        Motion.press(findViewById(R.id.btnNext));
        Motion.press(findViewById(R.id.btnJoin));
        Motion.press(findViewById(R.id.btnInvite));
        Motion.press(findViewById(R.id.btnWatchlist));
        Motion.press(findViewById(R.id.btnDownload));
        Ui.tint(findViewById(R.id.btnDownload), Color.WHITE);
        Motion.press(findViewById(R.id.btnSendChat));
        Motion.rise(findViewById(R.id.cineHeaderTop), 0);
        Motion.fadeUp(findViewById(R.id.serverBar), 80);
        Ui.padTopInset(findViewById(R.id.cineHeaderTop));
        findViewById(R.id.btnPrev).setOnClickListener(v -> stepEpisode(-1));
        findViewById(R.id.btnNext).setOnClickListener(v -> stepEpisode(1));
        findViewById(R.id.btnWatchlist).setOnClickListener(v -> toggleWatchlist());
        findViewById(R.id.btnDownload).setOnClickListener(v -> showDownloadSheet());
        findViewById(R.id.btnJoin).setOnClickListener(v -> showJoin());
        findViewById(R.id.btnInvite).setOnClickListener(v -> invite());
        findViewById(R.id.btnSendChat).setOnClickListener(v -> sendChat());
        findViewById(R.id.btnJoinGo).setOnClickListener(v -> submitJoin());
        findViewById(R.id.btnJoinCancel).setOnClickListener(v -> hideJoin());
        findViewById(R.id.joinOverlay).setOnClickListener(v -> hideJoin());
        findViewById(R.id.joinCard).setOnClickListener(v -> {});
        EditText search = findViewById(R.id.episodeSearch);
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence c, int a, int b, int d) {}
            @Override public void onTextChanged(CharSequence c, int a, int b, int d) {}
            @Override public void afterTextChanged(Editable ed) { bindEpisodes(); }
        });
        EditText chat = findViewById(R.id.chatInput);
        chat.setOnEditorActionListener((v, action, ev) -> {
            if (action == EditorInfo.IME_ACTION_SEND
                    || (ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER && ev.getAction() == KeyEvent.ACTION_DOWN)) {
                sendChat();
                return true;
            }
            return false;
        });
        paintHeader();
        paintWatchlist();
        if (id <= 0) {
            status("Title missing.");
            return;
        }
        loadWatch();
    }

    private void paintHeader() {
        String playing = title == null || title.isEmpty() ? "Watch" : title;
        ((TextView) findViewById(R.id.watchTitle)).setText("Playing  " + playing);
        TextView badge = findViewById(R.id.watchBadge);
        boolean tv = isTv();
        badge.setVisibility(tv ? View.VISIBLE : View.GONE);
        if (tv) badge.setText(String.format(Locale.US, "S%d E%d", s, e));
        findViewById(R.id.tvBar).setVisibility(tv ? View.VISIBLE : View.GONE);
        ((TextView) findViewById(R.id.tvSeasonEp)).setText(String.format(Locale.US, "S%d · E%d", s, e));
        sizePlayerHost();
    }

    private boolean isTv() {
        return "tv".equals(type) || "anime".equals(type)
                || (seasons != null && !seasons.isEmpty());
    }

    private void loadWatch() {
        int gen = ++loadGen;
        embedGen++;
        clearEmbed();
        EmbedRecoveryUi.clear(playerHost);
        servers = new ArrayList<>();
        bindServers();
        getSharedPreferences("cineamit", 0).edit().putString("last_ep_" + type + "_" + id, s + "|" + e).apply();
        paintHeader();
        status("Loading stream…");
        progress(true);
        Io.run(this, () -> Api.watch(type, id, s, e), json -> {
            if (gen != loadGen) return;
            progress(false);
            if (!json.optBoolean("ok", true)) {
                showEmbedRecovery(watchError(json.optString("error", "Watch failed")));
                return;
            }
            String apiTitle = json.optString("title");
            if (apiTitle != null && !apiTitle.isEmpty() && !"null".equals(apiTitle)) title = apiTitle;
            servers = Api.parseServers(json.optJSONArray("servers"));
            seasons = Api.parseSeasons(json.optJSONArray("seasons"));
            inWatchlist = json.optBoolean("in_watchlist", inWatchlist);
            autoplay = json.optBoolean("autoplay_next", autoplay);
            if (serverIndex >= servers.size()) serverIndex = 0;
            paintHeader();
            paintWatchlist();
            bindServers();
            bindSeasons();
            if (isTv()) loadEpisodes(gen);
            if (servers.isEmpty()) {
                showEmbedRecovery("No embed server found. Retry later or ask Admin to add a server.");
                return;
            }
            playServer(serverIndex);
        }, ex -> {
            if (gen != loadGen) return;
            progress(false);
            showEmbedRecovery("Could not load the watch page. Retry or check your connection.");
        });
    }

    private String watchError(String err) {
        if ("kids_restricted".equals(err)) return "Restricted in Kids Mode.";
        if ("login_required".equals(err)) return "Sign in to play.";
        if ("title_unavailable".equals(err)) return "Title unavailable.";
        return err == null || err.isEmpty() ? "Watch failed" : err;
    }

    private void paintWatchlist() {
        ImageView iv = findViewById(R.id.btnWatchlist);
        if (iv == null) return;
        iv.setImageResource(inWatchlist ? R.drawable.ic_watch_list_remove : R.drawable.ic_watch_list_add);
        Ui.tint(iv, Color.WHITE);
    }

    private void toggleWatchlist() {
        if (watchlistBusy || id <= 0) return;
        if (Session.user == null) {
            Toast.makeText(this, "Sign in to use the watchlist.", Toast.LENGTH_SHORT).show();
            LoginActivity.open(this);
            return;
        }
        watchlistBusy = true;
        Io.run(this, () -> Api.watchlistToggle(type, id), json -> {
            watchlistBusy = false;
            if ("login_required".equals(json.optString("error"))) {
                LoginActivity.open(this);
                return;
            }
            if (json.optBoolean("ok")) {
                inWatchlist = json.optBoolean("in_watchlist");
                paintWatchlist();
            }
        }, e -> watchlistBusy = false);
    }

    private void showDownloadSheet() {
        if (id <= 0) return;
        if (Session.user == null) {
            Toast.makeText(this, "Sign in to download", Toast.LENGTH_SHORT).show();
            LoginActivity.open(this);
            return;
        }
        Toast.makeText(this, "Download Loading URL…", Toast.LENGTH_SHORT).show();
        Io.run(this, () -> Api.downloadOptions(type, id, s, e), json -> {
            JSONArray arr = json == null ? null : json.optJSONArray("downloads");
            if (arr == null || arr.length() == 0) {
                Toast.makeText(this, "No download links found.", Toast.LENGTH_LONG).show();
                return;
            }
            if (arr.length() == 1) {
                enqueueDownload(arr.optJSONObject(0));
                return;
            }
            CharSequence[] names = new CharSequence[arr.length()];
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                names[i] = o == null ? "Download" : o.optString("name", "Download");
            }
            new AlertDialog.Builder(this)
                    .setTitle("Download")
                    .setItems(names, (d, which) -> enqueueDownload(arr.optJSONObject(which)))
                    .setNegativeButton("Cancel", null)
                    .show();
        }, err -> Toast.makeText(this, CineAmitApp.friendlyNetError(err), Toast.LENGTH_LONG).show());
    }

    private void enqueueDownload(JSONObject server) {
        Downloads.Item seed = new Downloads.Item();
        seed.type = type;
        seed.id = id;
        seed.s = s;
        seed.e = e;
        seed.title = title == null || title.isEmpty() ? "Title" : title;
        if ("tv".equals(type) || "anime".equals(type)) {
            seed.title = seed.title + "  S" + s + "E" + e;
        }
        seed.quality = Downloads.Q_HIGH;
        if (server != null) {
            seed.token = server.optString("token");
            seed.sourceUrl = Downloads.cleanDlUrl(server);
            seed.serverName = server.optString("name");
        }
        DownloadService.askNotify(this);
        Downloads.enqueue(seed, seed.token);
        Toast.makeText(this, "Download page khul raha hai", Toast.LENGTH_SHORT).show();
    }

    private void bindServers() {
        LinearLayout row = findViewById(R.id.serverRow);
        row.removeAllViews();
        for (int i = 0; i < servers.size(); i++) {
            Server sv = servers.get(i);
            boolean sel = i == serverIndex;
            String label = sv.vip ? sv.name + " · Free access" : sv.name;
            TextView chip = Ui.chip(this, label, sel, null);
            final int idx = i;
            chip.setOnClickListener(v -> {
                if (idx == serverIndex) return;
                serverIndex = idx;
                bindServers();
                playServer(idx);
            });
            row.addView(chip);
        }
    }

    private void bindSeasons() {
        LinearLayout row = findViewById(R.id.seasonRow);
        row.removeAllViews();
        if (!isTv() || seasons == null || seasons.isEmpty()) return;
        for (Season season : seasons) {
            boolean sel = season.season_number == s;
            String label = season.name == null || season.name.isEmpty()
                    ? "S" + season.season_number : season.name;
            TextView chip = Ui.chip(this, label, sel, null);
            chip.setOnClickListener(v -> {
                if (season.season_number == s) return;
                s = season.season_number;
                e = 1;
                serverIndex = 0;
                loadWatch();
            });
            row.addView(chip);
        }
    }

    private void loadEpisodes(int gen) {
        Io.run(this, () -> Api.episodes(id, s), json -> {
            if (gen != loadGen) return;
            allEpisodes = Api.parseEpisodes(json.optJSONArray("episodes"));
            episodes = allEpisodes;
            bindEpisodes();
        }, ex -> {});
    }

    private void bindEpisodes() {
        LinearLayout row = findViewById(R.id.episodeRow);
        if (row == null) return;
        row.removeAllViews();
        if (allEpisodes == null) allEpisodes = new ArrayList<>();
        String q = "";
        EditText search = findViewById(R.id.episodeSearch);
        if (search != null && search.getText() != null) q = search.getText().toString().trim().toLowerCase(Locale.US);
        List<Episode> show = new ArrayList<>();
        for (Episode ep : allEpisodes) {
            if (q.isEmpty()) {
                show.add(ep);
                continue;
            }
            String name = ep.name == null ? "" : ep.name.toLowerCase(Locale.US);
            String overview = ep.overview == null ? "" : ep.overview.toLowerCase(Locale.US);
            String num = String.valueOf(ep.episode_number);
            if (name.contains(q) || overview.contains(q) || num.equals(q) || ("e" + num).equals(q)) show.add(ep);
        }
        episodes = show;
        if (show.isEmpty()) {
            paintOverview(null);
            return;
        }
        LayoutInflater inf = LayoutInflater.from(this);
        View selected = null;
        Episode playing = null;
        for (Episode ep : show) {
            View card = inf.inflate(R.layout.item_watch_episode, row, false);
            boolean sel = ep.episode_number == e;
            if (sel) playing = ep;
            card.setBackgroundResource(sel ? R.drawable.ep_card_on : R.drawable.ep_card);
            ImageView still = card.findViewById(R.id.still);
            Images.load(still, Api.img(Session.imageBase, ep.still_path, "w500"), R.drawable.place_holder_show);
            TextView badge = card.findViewById(R.id.epBadge);
            String meta = "E" + ep.episode_number;
            if (ep.runtime > 0) meta += "  ·  " + ep.runtime + "m";
            badge.setText(meta);
            TextView name = card.findViewById(R.id.name);
            name.setText(ep.name == null || ep.name.isEmpty() ? ("Episode " + ep.episode_number) : ep.name);
            View now = card.findViewById(R.id.nowBadge);
            if (now != null) now.setVisibility(sel ? View.VISIBLE : View.GONE);
            Motion.press(card);
            int n = Math.max(1, ep.episode_number);
            card.setOnClickListener(v -> {
                if (n == e) return;
                e = n;
                serverIndex = 0;
                loadWatch();
            });
            row.addView(card);
            if (sel) selected = card;
        }
        if (playing == null) {
            for (Episode ep : allEpisodes) if (ep.episode_number == e) { playing = ep; break; }
        }
        paintOverview(playing);
        if (selected != null) {
            HorizontalScrollView sc = findViewById(R.id.episodeScroll);
            final View target = selected;
            if (sc != null) {
                target.post(() -> sc.smoothScrollTo(Math.max(0, target.getLeft() - dp(16)), 0));
            }
        }
    }

    private void paintOverview(Episode ep) {
        TextView tv = findViewById(R.id.episodeOverview);
        if (tv == null) return;
        if (ep == null || ep.overview == null || ep.overview.trim().isEmpty()) {
            tv.setVisibility(View.GONE);
            return;
        }
        tv.setText(ep.overview.trim());
        tv.setVisibility(View.VISIBLE);
    }

    private void stepEpisode(int delta) {
        if (!isTv()) return;
        List<Episode> list = (allEpisodes != null && !allEpisodes.isEmpty()) ? allEpisodes : episodes;
        if (list != null && !list.isEmpty()) {
            int idx = -1;
            for (int i = 0; i < list.size(); i++) {
                if (list.get(i).episode_number == e) {
                    idx = i;
                    break;
                }
            }
            if (idx < 0) idx = 0;
            int next = idx + delta;
            if (next >= 0 && next < list.size()) {
                e = Math.max(1, list.get(next).episode_number);
                serverIndex = 0;
                loadWatch();
                return;
            }
            if (delta > 0) goNextSeason();
            else goPrevSeason();
            return;
        }
        if (delta < 0 && e <= 1) {
            goPrevSeason();
            return;
        }
        e = Math.max(1, e + delta);
        serverIndex = 0;
        loadWatch();
    }

    private void goNextSeason() {
        if (seasons == null || seasons.isEmpty()) return;
        for (int i = 0; i < seasons.size(); i++) {
            if (seasons.get(i).season_number == s && i + 1 < seasons.size()) {
                s = seasons.get(i + 1).season_number;
                e = 1;
                serverIndex = 0;
                loadWatch();
                return;
            }
        }
    }

    private void goPrevSeason() {
        if (seasons == null || seasons.isEmpty()) return;
        for (int i = 0; i < seasons.size(); i++) {
            if (seasons.get(i).season_number == s && i > 0) {
                Season prev = seasons.get(i - 1);
                s = prev.season_number;
                serverIndex = 0;
                Io.run(this, () -> Api.episodes(id, s), json -> {
                    allEpisodes = Api.parseEpisodes(json.optJSONArray("episodes"));
                    episodes = allEpisodes;
                    if (allEpisodes != null && !allEpisodes.isEmpty()) {
                        e = Math.max(1, allEpisodes.get(allEpisodes.size() - 1).episode_number);
                    } else {
                        e = prev.episode_count > 0 ? prev.episode_count : 1;
                    }
                    loadWatch();
                }, ex -> {
                    e = prev.episode_count > 0 ? prev.episode_count : 1;
                    loadWatch();
                });
                return;
            }
        }
    }

    private void maybeAutoplay() {
        if (!autoplay || !isTv() || cinema) return;
        if (!autoplayArmed) return;
        if (System.currentTimeMillis() - embedAt < 8000) return;
        autoplayArmed = false;
        List<Episode> list = (allEpisodes != null && !allEpisodes.isEmpty()) ? allEpisodes : episodes;
        boolean hasNext = false;
        if (list != null) {
            for (int i = 0; i < list.size(); i++) {
                if (list.get(i).episode_number == e && i + 1 < list.size()) hasNext = true;
            }
        }
        boolean nextSeason = false;
        if (!hasNext && seasons != null) {
            for (int i = 0; i < seasons.size(); i++) {
                if (seasons.get(i).season_number == s && i + 1 < seasons.size()) nextSeason = true;
            }
        }
        if (!hasNext && !nextSeason) return;
        Toast.makeText(this, "Next episode…", Toast.LENGTH_SHORT).show();
        stepEpisode(1);
    }

    private void playServer(int index) {
        if (index < 0 || index >= servers.size()) return;
        Server sv = servers.get(index);
        String play = sv.play;
        if (play == null || play.trim().isEmpty()) {
            status("Server URL missing.");
            return;
        }
        clearEmbed();
        EmbedRecoveryUi.clear(playerHost);
        status("Loading stream…");
        progress(true);
        String url = Api.abs(play.trim());
        int gen = ++embedGen;
        Io.run(this, () -> Api.resolveEmbed(url), resolved -> {
            if (gen != embedGen) return;
            progress(false);
            if (resolved == null || resolved.isEmpty()) {
                showEmbedRecovery("Player link expired or unavailable. Retry this server or choose another server.");
                return;
            }
            attachWebView(resolved, sv.vip || Sub.isPremium());
        }, ex -> {
            if (gen != embedGen) return;
            progress(false);
            showEmbedRecovery(ex instanceof Api.PlaybackAccessException ? ex.getMessage() : "Embed failed. Retry or check your network.");
        });
    }

    private void clearEmbed() { clearEmbed(false); }

    private void clearEmbed(boolean rendererGone) {
        autoplayArmed = false;
        if (embedClient != null) embedClient.dispose();
        embedClient = null;
        hideCustomView();
        WebView old = webView;
        webView = null;
        EmbedRecoveryUi.destroy(old, rendererGone);
    }

    private void showEmbedRecovery(String message) {
        progress(false);
        status(null);
        Runnable next = servers.size() > 1 ? () -> {
            if (!Io.alive(this)) return;
            serverIndex = (serverIndex + 1) % servers.size();
            loadWatch();
        } : null;
        EmbedRecoveryUi.show(playerHost, message, () -> {
            if (Io.alive(this)) loadWatch(); // Refresh expiring secure-play links; keep quota/profile checks.
        }, next);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void attachWebView(String url, boolean hideProviderAds) {
        clearEmbed();
        EmbedRecoveryUi.clear(playerHost);
        status(null);
        embedAt = System.currentTimeMillis();
        autoplayArmed = true;
        WebView wv = new WebView(this);
        webView = wv;
        wv.setBackgroundColor(Color.BLACK);
        WebSettings settings = wv.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(true);
        WebSecurity.harden(wv);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true);
        wv.addJavascriptInterface(new PlayerBridge(embedGen), "CineAmit");
        EmbedWebViewClient client = new EmbedWebViewClient(url, CineAmitApp.baseUrl(), hideProviderAds,
                new EmbedWebViewClient.Events() {
                    @Override public void ready(WebView view) {
                        if (view != webView || !Io.alive(WatchActivity.this)) return;
                        status(null);
                        view.evaluateJavascript(ENDED_JS, null);
                    }
                    @Override public void failed(WebView view, String message, boolean rendererGone) {
                        if (view != webView) return;
                        clearEmbed(rendererGone);
                        if (Io.alive(WatchActivity.this)) showEmbedRecovery(message);
                    }
                });
        embedClient = client;
        wv.setWebViewClient(client);
        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                enterCinema(view, callback);
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                return client.blockPopup(view, isUserGesture, resultMsg);
            }
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
                return client.console(message);
            }
        });
        wv.setFocusable(true);
        wv.setFocusableInTouchMode(true);
        wv.setClickable(true);
        wv.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
        wv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        wv.setOnTouchListener((v, ev) -> {
            if (!v.hasFocus()) v.requestFocus();
            return false;
        });
        playerHost.setClickable(false);
        playerHost.addView(wv, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        wv.requestFocus(View.FOCUS_DOWN);
        Api.syncCookiesToWebView();
        Map<String, String> headers = new HashMap<>();
        headers.put("Referer", CineAmitApp.baseUrl() + "/");
        if (WebSecurity.navigationAllowed(url)) wv.loadUrl(url, headers);
        else {
            clearEmbed(false);
            showEmbedRecovery("HTTPS player required. Choose a secure server.");
        }
    }

    private void enterCinema(View custom, WebChromeClient.CustomViewCallback callback) {
        if (chromeCustom != null) hideCustomView();
        cinema = true;
        chromeCustom = custom;
        chromeCallback = callback;
        watchPage.setVisibility(View.GONE);
        fullscreenHost.setVisibility(View.VISIBLE);
        fullscreenHost.removeAllViews();
        if (custom != null) {
            fullscreenHost.addView(custom, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        if (webView != null) webView.setVisibility(View.INVISIBLE);
        immersive(true);
    }

    private void hideCustomView() {
        if (chromeCustom != null && chromeCustom.getParent() instanceof ViewGroup) {
            ((ViewGroup) chromeCustom.getParent()).removeView(chromeCustom);
        }
        chromeCustom = null;
        if (chromeCallback != null) chromeCallback.onCustomViewHidden();
        chromeCallback = null;
        cinema = false;
        if (fullscreenHost != null) {
            fullscreenHost.removeAllViews();
            fullscreenHost.setVisibility(View.GONE);
        }
        if (watchPage != null) watchPage.setVisibility(View.VISIBLE);
        if (webView != null) webView.setVisibility(View.VISIBLE);
        immersive(false);
    }

    @SuppressWarnings("deprecation")
    private void immersive(boolean on) {
        View decor = getWindow().getDecorView();
        if (on) {
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
            if (Build.VERSION.SDK_INT >= 28) {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                getWindow().setAttributes(lp);
            }
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    private String partyName() {
        AppUser u = Session.user;
        if (u == null) return "Guest";
        if (u.profile_name != null && !u.profile_name.isEmpty()) return u.profile_name;
        if (u.username != null && !u.username.isEmpty()) return u.username;
        return "Guest";
    }

    private String newRoom() {
        String chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        StringBuilder sb = new StringBuilder();
        java.util.Random r = new java.util.Random();
        for (int i = 0; i < 6; i++) sb.append(chars.charAt(r.nextInt(chars.length())));
        return sb.toString();
    }

    private String cleanRoom(String raw) {
        if (raw == null) return "";
        return raw.trim().replaceAll("[^A-Za-z0-9_-]", "").toUpperCase(Locale.US);
    }

    private void showJoin() {
        Ui.show(findViewById(R.id.joinOverlay), true);
        EditText in = findViewById(R.id.joinRoomInput);
        in.setText(room);
        in.requestFocus();
    }

    private void hideJoin() {
        Ui.show(findViewById(R.id.joinOverlay), false);
    }

    private void submitJoin() {
        String code = cleanRoom(((EditText) findViewById(R.id.joinRoomInput)).getText().toString());
        if (code.length() < 2) {
            Toast.makeText(this, "Enter a room code.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (code.equals(room) && partyStarted) {
            Toast.makeText(this, "You are already in this room.", Toast.LENGTH_SHORT).show();
            hideJoin();
            return;
        }
        room = code;
        hideJoin();
        startParty(true);
    }

    private void invite() {
        if (room == null || room.length() < 2) room = newRoom();
        if (!partyStarted) startParty(false);
        else {
            Ui.show(findViewById(R.id.partyLive), true);
            ((TextView) findViewById(R.id.partyRoom)).setText("Room  #" + room + "  ·  share this code");
        }
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("CineAmit party", room));
        } catch (Exception ignored) {}
        Toast.makeText(this, "Room copied: " + room, Toast.LENGTH_SHORT).show();
        try {
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("text/plain");
            share.putExtra(Intent.EXTRA_TEXT, "Join my CineAmit Watch Party: " + room
                    + "\n" + title + (isTv() ? (" S" + s + "E" + e) : ""));
            startActivity(Intent.createChooser(share, "Invite friends"));
        } catch (Exception ignored) {}
    }

    private void startParty(boolean joined) {
        if (room == null || room.length() < 2) return;
        partyStarted = true;
        Ui.show(findViewById(R.id.partyLive), true);
        ((TextView) findViewById(R.id.partyRoom)).setText("Room  #" + room
                + (joined ? "  ·  joined" : "  ·  share this code"));
        partyHandler.removeCallbacks(partyTick);
        Io.run(this, () -> Api.partyJoin(partyName(), room), json -> {
            if (json.optLong("last_id") > 0) partyLastId = Math.max(0, json.optLong("last_id") - 1);
            appendSystem(joined ? "Joined #" + room : "Party started #" + room);
            pollParty();
            partyHandler.postDelayed(partyTick, 25000);
        }, ex -> {
            appendSystem("Could not join party. Check your network.");
        });
    }

    private void pollParty() {
        if (!partyStarted || room == null || room.length() < 2) return;
        if (Session.user == null) {
            partyHandler.postDelayed(partyTick, 25000);
            return;
        }
        final String r = room;
        final long since = partyLastId;
        Io.run(this, () -> Api.partyMessages(r, since), json -> {
            if (!r.equals(room)) return;
            if ("login_required".equals(json.optString("error"))) {
                partyHandler.postDelayed(partyTick, 25000);
                return;
            }
            JSONArray arr = json.optJSONArray("messages");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject m = arr.optJSONObject(i);
                    if (m != null) appendChat(m.optString("type"), m.optString("user"), m.optString("msg"));
                }
            }
            long last = json.optLong("last_id", partyLastId);
            if (last > 0) partyLastId = last;
            partyHandler.removeCallbacks(partyTick);
            partyHandler.postDelayed(partyTick, 25000);
        }, ex -> partyHandler.postDelayed(partyTick, 25000));
    }

    private void sendChat() {
        EditText in = findViewById(R.id.chatInput);
        String msg = in.getText() == null ? "" : in.getText().toString().trim();
        if (msg.isEmpty()) return;
        if (Session.user == null) {
            appendSystem("Sign in to chat.");
            LoginActivity.open(this);
            return;
        }
        if (room == null || room.length() < 2) {
            room = newRoom();
            startParty(false);
        }
        if (partyBusy) return;
        partyBusy = true;
        final String text = msg;
        in.setText("");
        Io.run(this, () -> Api.partySend(partyName(), room, text), json -> {
            partyBusy = false;
            if ("login_required".equals(json.optString("error"))) {
                appendSystem("Session expired. Sign in again.");
                LoginActivity.open(this);
                return;
            }
            if ("slow_down".equals(json.optString("error"))) {
                appendSystem("Try again in a moment.");
                return;
            }
            if (json.optBoolean("ok")) pollParty();
            else appendSystem("Message was not sent.");
        }, ex -> {
            partyBusy = false;
            appendSystem("Network error — message was not sent.");
        });
    }

    private void appendSystem(String msg) {
        appendChat("system", "CineAmit", msg);
    }

    private void appendChat(String type, String user, String msg) {
        LinearLayout list = findViewById(R.id.chatList);
        if (list == null || msg == null || msg.isEmpty()) return;
        boolean sys = "system".equals(type);
        boolean me = !sys && partyName().equals(user);
        TextView tv = new TextView(this);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        if (sys) {
            lp.gravity = android.view.Gravity.CENTER_HORIZONTAL;
            tv.setText(msg);
            tv.setTextColor(0xFF9CA3AF);
            tv.setTextSize(11);
        } else {
            lp.gravity = me ? android.view.Gravity.END : android.view.Gravity.START;
            tv.setText((user == null ? "" : user) + "\n" + msg);
            tv.setTextColor(me ? 0xFF111111 : 0xFFF4F1EA);
            tv.setBackgroundColor(me ? 0xFFA78BFA : 0xFF1C1D24);
            tv.setPadding(dp(12), dp(8), dp(12), dp(8));
            tv.setTextSize(13);
        }
        tv.setLayoutParams(lp);
        list.addView(tv);
        NestedScrollView below = findViewById(R.id.belowPlayer);
        if (below != null) below.post(() -> below.fullScroll(View.FOCUS_DOWN));
    }

    private void status(String msg) {
        TextView tv = findViewById(R.id.watchStatus);
        if (tv == null) return;
        if (msg == null || msg.isEmpty()) {
            tv.setVisibility(View.GONE);
            return;
        }
        tv.setText(msg);
        tv.setVisibility(View.VISIBLE);
    }

    private void progress(boolean on) {
        ProgressBar p = findViewById(R.id.watchProgress);
        if (p != null) p.setVisibility(on ? View.VISIBLE : View.GONE);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void sizePlayerHost() {
        if (playerHost == null) return;
        int w = getResources().getDisplayMetrics().widthPixels;
        int h16 = Math.round(w * 9f / 16f);
        int min = dp(220);
        int max = Math.round(getResources().getDisplayMetrics().heightPixels * (isTv() ? 0.42f : 0.55f));
        int h = Math.max(min, Math.min(h16, max));
        ViewGroup.LayoutParams lp = playerHost.getLayoutParams();
        lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
        lp.height = h;
        playerHost.setLayoutParams(lp);
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        sizePlayerHost();
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT < 26 || AccessGate.blocked()) return;
        if (webView == null) return;
        pipAttempt = true;
        try {
            enterPictureInPictureMode(new PictureInPictureParams.Builder().build());
        } catch (Exception e) {
            pipAttempt = false;
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, @NonNull Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        AccessGate.pictureInPictureChanged(this, isInPictureInPictureMode);
        pipAttempt = false;
        if (isInPictureInPictureMode) {
            if (watchPage != null) watchPage.setVisibility(View.GONE);
            if (findViewById(R.id.joinOverlay) != null) findViewById(R.id.joinOverlay).setVisibility(View.GONE);
        } else if (!cinema) {
            if (watchPage != null) watchPage.setVisibility(View.VISIBLE);
            immersive(false);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (findViewById(R.id.joinOverlay).getVisibility() == View.VISIBLE) {
            hideJoin();
            return;
        }
        if (chromeCustom != null || cinema) {
            hideCustomView();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (pipAttempt || (Build.VERSION.SDK_INT >= 24 && isInPictureInPictureMode())) return;
        if (webView != null) webView.onPause();
        partyHandler.removeCallbacks(partyTick);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (cinema) immersive(true);
        if (partyStarted) {
            partyHandler.removeCallbacks(partyTick);
            partyHandler.postDelayed(partyTick, 400);
        }
    }

    @Override
    protected void onDestroy() {
        loadGen++;
        embedGen++;
        partyHandler.removeCallbacks(partyTick);
        clearEmbed();
        super.onDestroy();
    }
}
