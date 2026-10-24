package in.cineamit.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.fragment.app.FragmentActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.PagerSnapHelper;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.MediaItem;
import in.cineamit.app.ui.Motion;
import in.cineamit.app.ui.PosterAdapter;
import in.cineamit.app.ui.Ui;

public class ReelsActivity extends FragmentActivity {
    private RecyclerView list;
    private LinearLayoutManager lm;
    private PagerSnapHelper snap;
    private Adapter adapter;
    private int playing = -1;
    private boolean muted;
    private int trailerGen;

    public static void open(Context ctx) {
        Intent i = new Intent(ctx, ReelsActivity.class);
        if (!(ctx instanceof android.app.Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_reels);
        View back = findViewById(R.id.btnBack);
        back.setOnClickListener(v -> finish());
        Ui.padTopInset(back);
        list = findViewById(R.id.reels);
        lm = new LinearLayoutManager(this, RecyclerView.VERTICAL, false);
        list.setLayoutManager(lm);
        snap = new PagerSnapHelper();
        snap.attachToRecyclerView(list);
        list.addOnScrollListener(new RecyclerView.OnScrollListener() {
            @Override
            public void onScrollStateChanged(@NonNull RecyclerView rv, int state) {
                if (state == RecyclerView.SCROLL_STATE_IDLE) playSnapped();
            }
        });
        findViewById(R.id.progress).setVisibility(View.VISIBLE);
        Io.run(this, () -> Api.page("reels"), json -> {
            findViewById(R.id.progress).setVisibility(View.GONE);
            Api.applyMeta(json);
            List<MediaItem> items = Api.parseItems(json.optJSONArray("items"));
            if (items == null || items.isEmpty()) {
                TextView s = findViewById(R.id.status);
                s.setText("No reels found.");
                s.setVisibility(View.VISIBLE);
                return;
            }
            adapter = new Adapter(items);
            list.setAdapter(adapter);
            list.post(this::playSnapped);
            list.postDelayed(this::playSnapped, 120);
            list.postDelayed(this::playSnapped, 400);
        }, e -> {
            findViewById(R.id.progress).setVisibility(View.GONE);
            TextView s = findViewById(R.id.status);
            s.setText(CineAmitApp.friendlyNetError(e));
            s.setVisibility(View.VISIBLE);
        });
    }

    private int snapPos() {
        View v = snap.findSnapView(lm);
        if (v == null) return Math.max(0, lm.findFirstCompletelyVisibleItemPosition());
        int p = lm.getPosition(v);
        return p < 0 ? 0 : p;
    }

    private void playSnapped() {
        if (adapter == null || adapter.data.isEmpty()) return;
        int pos = snapPos();
        if (pos < 0) pos = 0;
        if (pos >= adapter.data.size()) pos = adapter.data.size() - 1;
        Adapter.VH h = holder(pos);
        if (h == null) {
            final int want = pos;
            list.postDelayed(() -> {
                if (adapter == null) return;
                Adapter.VH again = holder(want);
                if (again != null && playing != want) {
                    stopPlaying();
                    playing = want;
                    startReel(again, adapter.data.get(want), want);
                }
            }, 90);
            return;
        }
        if (pos == playing) return;
        stopPlaying();
        playing = pos;
        startReel(h, adapter.data.get(pos), pos);
    }

    private Adapter.VH holder(int pos) {
        RecyclerView.ViewHolder raw = list.findViewHolderForAdapterPosition(pos);
        return raw instanceof Adapter.VH ? (Adapter.VH) raw : null;
    }

    private void stopPlaying() {
        if (playing < 0 || adapter == null) return;
        Adapter.VH h = holder(playing);
        if (h != null) h.stopVideo();
        playing = -1;
    }

    private void startReel(Adapter.VH h, MediaItem it, int pos) {
        h.bindMeta(it, muted);
        h.showPoster();
        final int gen = ++trailerGen;
        String type = it.media_type == null ? "movie" : it.media_type;
        Io.run(this, () -> Api.trailer(type, it.id), json -> {
            if (gen != trailerGen || playing != pos) return;
            String key = json.optString("key");
            if (key == null || key.isEmpty() || "null".equalsIgnoreCase(key)) {
                Toast.makeText(this, "Trailer not found", Toast.LENGTH_SHORT).show();
                return;
            }
            grabAudio();
            h.playVideo(key, muted);
        }, e -> {
            if (gen != trailerGen || playing != pos) return;
            Toast.makeText(this, "Trailer failed to load", Toast.LENGTH_SHORT).show();
        });
    }

    private void grabAudio() {
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am != null) {
                am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
            }
        } catch (Exception ignored) {}
    }

    private void setMuted(boolean on) {
        muted = on;
        Adapter.VH h = holder(playing);
        if (h != null && h.ytKey != null) h.playVideo(h.ytKey, muted);
        else if (h != null) h.paintMute(muted);
    }

    @Override
    protected void onPause() {
        super.onPause();
        Adapter.VH h = holder(playing);
        if (h != null && h.web != null) h.web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        Adapter.VH h = holder(playing);
        if (h != null && h.web != null) {
            h.web.onResume();
            grabAudio();
        }
    }

    @Override
    protected void onDestroy() {
        stopPlaying();
        super.onDestroy();
    }

    class Adapter extends RecyclerView.Adapter<Adapter.VH> {
        final List<MediaItem> data;
        Adapter(List<MediaItem> data) { this.data = data == null ? new ArrayList<>() : data; }

        @NonNull
        @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_reel, parent, false);
            v.setLayoutParams(new RecyclerView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            return new VH(v);
        }

        @Override
        public void onBindViewHolder(@NonNull VH h, int position) {
            MediaItem it = data.get(position);
            h.bindMeta(it, muted);
            h.showPoster();
            String type = it.media_type == null ? "movie" : it.media_type;
            h.play.setOnClickListener(v -> WatchActivity.open(ReelsActivity.this, type, it.id, it.title, 1, 1));
            h.info.setOnClickListener(v -> DetailsActivity.open(ReelsActivity.this, type, it.id));
            h.watchlist.setOnClickListener(v -> Io.run(ReelsActivity.this,
                    () -> Api.watchlistToggle(type, it.id),
                    json -> Toast.makeText(ReelsActivity.this,
                            json.optBoolean("in_watchlist", true) ? "Added to watchlist" : "Removed from watchlist",
                            Toast.LENGTH_SHORT).show(),
                    e -> Toast.makeText(ReelsActivity.this, CineAmitApp.friendlyNetError(e), Toast.LENGTH_SHORT).show()));
            h.mute.setOnClickListener(v -> setMuted(!muted));
            Motion.press(h.play);
            Motion.press(h.info);
            Motion.press(h.watchlist);
            Motion.press(h.mute);
        }

        @Override
        public void onViewRecycled(@NonNull VH h) {
            h.stopVideo();
            super.onViewRecycled(h);
        }

        @Override public int getItemCount() { return data.size(); }

        class VH extends RecyclerView.ViewHolder {
            final ImageView poster;
            final WebView web;
            final TextView kind, title, meta, overview, play, info, watchlist, mute;
            String ytKey;

            VH(View v) {
                super(v);
                poster = v.findViewById(R.id.poster);
                web = v.findViewById(R.id.reelVideo);
                kind = v.findViewById(R.id.kindBadge);
                title = v.findViewById(R.id.title);
                meta = v.findViewById(R.id.meta);
                overview = v.findViewById(R.id.overview);
                play = v.findViewById(R.id.btnPlay);
                info = v.findViewById(R.id.btnInfo);
                watchlist = v.findViewById(R.id.btnWatchlist);
                mute = v.findViewById(R.id.btnMute);
                tuneWeb();
            }

            @SuppressLint("SetJavaScriptEnabled")
            void tuneWeb() {
                if (web == null) return;
                web.setBackgroundColor(0xFF000000);
                web.setFocusable(false);
                web.setClickable(false);
                web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
                try {
                    CookieManager cm = CookieManager.getInstance();
                    cm.setAcceptCookie(true);
                    cm.setAcceptThirdPartyCookies(web, true);
                } catch (Exception ignored) {}
                WebSettings s = web.getSettings();
                s.setJavaScriptEnabled(true);
                s.setDomStorageEnabled(true);
                s.setDatabaseEnabled(true);
                s.setMediaPlaybackRequiresUserGesture(false);
                s.setLoadWithOverviewMode(true);
                s.setUseWideViewPort(true);
                WebSecurity.harden(web);
                s.setUserAgentString(
                        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
                web.setWebChromeClient(new WebChromeClient());
                web.setWebViewClient(new WebViewClient() {
                    @Override public void onPageFinished(WebView view, String url) {
                        if (view != null) view.setVisibility(View.VISIBLE);
                    }
                });
            }

            void bindMeta(MediaItem it, boolean isMuted) {
                Images.loadPoster(poster, it);
                PosterAdapter.bindKind(kind, it);
                title.setText(it.title);
                String bits = it.vote_average > 0 ? ("★ " + String.format(java.util.Locale.US, "%.1f", it.vote_average)) : "";
                if (it.year != null && !it.year.isEmpty()) bits = bits.isEmpty() ? it.year : bits + "  ·  " + it.year;
                meta.setText(bits);
                overview.setText(it.overview == null ? "" : it.overview);
                paintMute(isMuted);
            }

            void paintMute(boolean isMuted) {
                if (mute != null) mute.setText(isMuted ? "🔇" : "🔊");
            }

            void showPoster() {
                poster.setVisibility(View.VISIBLE);
                if (web != null) web.setVisibility(View.GONE);
            }

            void playVideo(String key, boolean isMuted) {
                ytKey = key;
                paintMute(isMuted);
                if (web == null || key == null || key.isEmpty()) return;
                String safe = key.replaceAll("[^A-Za-z0-9_-]", "");
                if (safe.isEmpty()) return;
                String html = "<!DOCTYPE html><html><head><meta charset='utf-8'>"
                        + "<meta name='viewport' content='width=device-width,initial-scale=1,maximum-scale=1'>"
                        + "<style>html,body,#player{margin:0;padding:0;background:#000;width:100%;height:100%;overflow:hidden}"
                        + "iframe{width:100%!important;height:100%!important;border:0}</style></head><body>"
                        + "<div id='player'></div>"
                        + "<script src='https://www.youtube.com/iframe_api'></script>"
                        + "<script>var wantMute=" + (isMuted ? "true" : "false") + ";"
                        + "function onYouTubeIframeAPIReady(){"
                        + "new YT.Player('player',{videoId:'" + safe + "',width:'100%',height:'100%',"
                        + "playerVars:{autoplay:1,mute:1,controls:0,modestbranding:1,rel:0,playsinline:1,loop:1,playlist:'"
                        + safe + "',fs:0,origin:'https://www.youtube.com'},"
                        + "events:{onReady:function(e){try{e.target.mute();e.target.playVideo();}catch(x){}"
                        + "if(!wantMute){setTimeout(function(){try{e.target.unMute();e.target.setVolume(100);e.target.playVideo();}catch(x){}},700);"
                        + "setTimeout(function(){try{e.target.unMute();e.target.playVideo();}catch(x){}},1800);}}"
                        + ",onStateChange:function(e){if(e.data===0)try{e.target.playVideo();}catch(x){}}"
                        + "}});}setTimeout(function(){if(!window.YT||!YT.Player)onYouTubeIframeAPIReady();},2500);"
                        + "</script></body></html>";
                web.setVisibility(View.VISIBLE);
                web.loadDataWithBaseURL("https://www.youtube.com", html, "text/html", "utf-8", null);
            }

            void stopVideo() {
                ytKey = null;
                if (web == null) return;
                try {
                    web.stopLoading();
                    web.loadUrl("about:blank");
                } catch (Exception ignored) {}
                web.setVisibility(View.GONE);
                poster.setVisibility(View.VISIBLE);
            }
        }
    }
}
