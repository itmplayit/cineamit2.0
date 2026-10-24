package in.cineamit.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.PictureInPictureParams;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.SeekParameters;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.ui.PlayerView;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import in.cineamit.app.data.Api;
import in.cineamit.app.ui.Ui;

@androidx.annotation.OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends Activity {
    private ExoPlayer player;
    private PlayerView playerView;
    private org.videolan.libvlc.LibVLC libVLC;
    private org.videolan.libvlc.MediaPlayer vlc;
    private org.videolan.libvlc.util.VLCVideoLayout vlcLayout;
    private WebView webView;
    private EmbedWebViewClient embedClient;
    private int embedGen;
    private String embedRequestUrl;
    private boolean hideProviderAds;
    private View chromeCustom;
    private WebChromeClient.CustomViewCallback chromeCallback;
    private FrameLayout playerHost;
    private FrameLayout fullscreenHost;
    private View watchPage;
    private ViewGroup cineControls;
    private boolean pipAttempt;
    private boolean cinema;
    private boolean controlsOn = true;
    private boolean locked;
    private boolean scrubbing;
    private boolean offlinePlay;
    private String admittedLocalUrl;
    private int volPct = 150;
    private int lastVol = 150;
    private float windowBright = -1f;
    private float gestX;
    private float gestY;
    private int gestVol0;
    private float gestBright0;
    private int gestMode;
    private boolean swipeLive;
    private boolean gestIgnore;
    private long gestSeek0;
    private int sleepMins;
    private long sleepAt;
    private int speedIdx = 1;
    private final float[] speeds = {0.75f, 1f, 1.25f, 1.5f, 2f};
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable hideCtrl = this::hideControls;
    private final Runnable tick = this::paintSeek;

    public static void open(Context ctx, String play, String title, boolean adblock) {
        open(ctx, play, title, adblock, false);
    }

    /** Live TV / IPTV / offline — VLC engine on device, never WebView. */
    public static void openNative(Context ctx, String play, String title) {
        open(ctx, play, title, false, true);
    }

    /** Offline download — local file via ExoPlayer. */
    public static void openLocal(Context ctx, String path, String title) {
        if (path == null || path.trim().isEmpty()) return;
        String play = path.startsWith("file:") ? path : "file://" + path;
        open(ctx, play, title, false, true);
    }

    private static void open(Context ctx, String play, String title, boolean adblock, boolean nativeOnly) {
        if (play == null || play.trim().isEmpty()) return;
        ctx.startActivity(new Intent(ctx, PlayerActivity.class)
                .putExtra("play", play)
                .putExtra("title", title == null ? "CineAmit" : title)
                .putExtra("adblock", adblock)
                .putExtra("native", nativeOnly));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_player);
        watchPage = findViewById(R.id.watchPage);
        playerHost = findViewById(R.id.playerHost);
        fullscreenHost = findViewById(R.id.fullscreenHost);
        ImageView back = findViewById(R.id.btnBack);
        Ui.tint(back, Color.WHITE);
        back.setOnClickListener(v -> finish());
        Ui.padTopInset(findViewById(R.id.cineHeaderTop));
        String title = getIntent().getStringExtra("title");
        ((TextView) findViewById(R.id.watchTitle)).setText(title == null || title.isEmpty() ? "Watch" : title);

        String playPath = getIntent().getStringExtra("play");
        if (playPath != null) playPath = playPath.trim();
        boolean adblock = getIntent().getBooleanExtra("adblock", false);
        boolean nativeOnly = getIntent().getBooleanExtra("native", false);
        if (playPath == null || playPath.isEmpty()) {
            finish();
            return;
        }
        if (playPath.startsWith("file:")) {
            if (!in.cineamit.app.data.Downloads.localPlaybackAllowed(playPath)) {showError("Offline file is unavailable or restricted for this profile.");return;}
            admittedLocalUrl=playPath;
            startExo(playPath);
            return;
        }
        String url = Api.abs(playPath);
        if (nativeOnly || isDirectStream(playPath, url)) startExo(url);
        else startEmbed(url, adblock);
    }

    private boolean isDirectStream(String play, String absUrl) {
        String p = play.toLowerCase();
        if (p.startsWith("file:")) return true;
        if (p.contains("/api/live_stream")) return true;
        if (p.contains("/api/secure_play")) return false;
        String path;
        try {
            path = new URI(absUrl).getPath();
            path = path == null ? p : path.toLowerCase();
        } catch (Exception e) {
            path = p;
        }
        return path.endsWith(".m3u8") || path.endsWith(".mp4") || path.endsWith(".mkv")
                || path.endsWith(".ts") || path.endsWith(".mpd") || path.endsWith(".avi");
    }

    private void startExo(String url) {
        if (url == null || (!url.startsWith("file:") && !WebSecurity.navigationAllowed(url))) {
            android.widget.Toast.makeText(this, "A valid HTTPS stream is required. Use a secure server or relay.", android.widget.Toast.LENGTH_LONG).show(); return;
        }
        View header = findViewById(R.id.cineHeaderTop);
        if (header != null) header.setVisibility(View.GONE);
        TextView pageTitle = findViewById(R.id.watchTitle);
        if (pageTitle != null) pageTitle.setVisibility(View.GONE);
        TextView hint = findViewById(R.id.watchHint);
        if (hint != null) hint.setVisibility(View.GONE);

        offlinePlay = url.startsWith("file:");
        vlcLayout = new org.videolan.libvlc.util.VLCVideoLayout(this);
        playerHost.addView(vlcLayout, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        cineControls = findViewById(R.id.cineControls);
        if (cineControls != null) cineControls.bringToFront();

        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am != null) {
                am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
            }
        } catch (Exception ignored) {}

        java.util.ArrayList<String> opts = new java.util.ArrayList<>();
        opts.add("--audio-time-stretch");
        opts.add("--network-caching=2800");
        opts.add("--live-caching=2800");
        opts.add("--file-caching=1500");
        opts.add("--sout-mux-caching=1500");
        opts.add("--http-reconnect");
        opts.add("--avcodec-hw=any");
        opts.add("--no-drop-late-frames");
        opts.add("--gain=2");
        libVLC = new org.videolan.libvlc.LibVLC(this, opts);
        vlc = new org.videolan.libvlc.MediaPlayer(libVLC);
        vlc.attachViews(vlcLayout, null, false, false);
        org.videolan.libvlc.Media media = new org.videolan.libvlc.Media(libVLC, android.net.Uri.parse(url));
        media.setHWDecoderEnabled(true, true);
        media.addOption(":network-caching=2800");
        media.addOption(":gain=2");
        media.addOption(":http-user-agent=" + in.cineamit.app.data.StalkerClient.UA);
        String magCookie = in.cineamit.app.data.StalkerClient.httpCookie();
        if (magCookie != null && !magCookie.isEmpty() && !offlinePlay
                && in.cineamit.app.data.StalkerClient.isPortalOrigin(url)) {
            media.addOption(":http-cookie=" + magCookie);
        }
        vlc.setMedia(media);
        media.release();
        applyVolume();
        vlc.setEventListener(event -> {
            if (event.type == org.videolan.libvlc.MediaPlayer.Event.Playing
                    || event.type == org.videolan.libvlc.MediaPlayer.Event.Paused
                    || event.type == org.videolan.libvlc.MediaPlayer.Event.Stopped) {
                ui.post(() -> {
                    applyVolume();
                    paintPlay();
                });
            } else if (event.type == org.videolan.libvlc.MediaPlayer.Event.EncounteredError) {
                ui.post(() -> Toast.makeText(this, offlinePlay ? "File could not play" : "Live stream could not play", Toast.LENGTH_LONG).show());
            } else if (event.type == org.videolan.libvlc.MediaPlayer.Event.TimeChanged
                    || event.type == org.videolan.libvlc.MediaPlayer.Event.LengthChanged) {
                ui.post(this::paintSeek);
            }
        });
        vlc.play();
        applyVolume();
        bindControls(offlinePlay);
        immersive(true);
    }

    private void bindControls(boolean offline) {
        cineControls = findViewById(R.id.cineControls);
        if (cineControls == null) return;
        cineControls.setVisibility(View.VISIBLE);
        cineControls.bringToFront();
        cineControls.setClickable(true);
        String title = getIntent().getStringExtra("title");
        TextView t = findViewById(R.id.ctrlTitle);
        if (t != null) t.setText(title == null || title.isEmpty() ? "CineAmit" : title);
        TextView badge = findViewById(R.id.ctrlBadge);
        if (badge != null) badge.setText(offline ? "OFFLINE" : "LIVE");
        ImageView back = findViewById(R.id.ctrlBack);
        if (back != null) {
            Ui.tint(back, Color.WHITE);
            back.setOnClickListener(v -> finish());
        }
        ImageView play = findViewById(R.id.ctrlPlay);
        ImageView rew = findViewById(R.id.ctrlRew);
        ImageView fwd = findViewById(R.id.ctrlFwd);
        ImageView lock = findViewById(R.id.ctrlLock);
        ImageView unlock = findViewById(R.id.ctrlUnlock);
        ImageView fs = findViewById(R.id.ctrlFs);
        TextView speed = findViewById(R.id.ctrlSpeed);
        TextView audio = findViewById(R.id.ctrlAudio);
        TextView sub = findViewById(R.id.ctrlSub);
        SeekBar seek = findViewById(R.id.ctrlSeek);
        if (play != null) play.setOnClickListener(v -> togglePlay());
        if (rew != null) rew.setOnClickListener(v -> skip(-10_000));
        if (fwd != null) fwd.setOnClickListener(v -> skip(10_000));
        if (lock != null) lock.setOnClickListener(v -> setLocked(true));
        if (unlock != null) unlock.setOnClickListener(v -> setLocked(false));
        if (fs != null) fs.setOnClickListener(v -> toggleFs());
        if (speed != null) speed.setOnClickListener(v -> cycleSpeed());
        TextView sleep = findViewById(R.id.ctrlSleep);
        if (sleep != null) sleep.setOnClickListener(v -> cycleSleep());
        TextView quality = findViewById(R.id.ctrlQuality);
        if (audio != null) audio.setOnClickListener(v -> pickVlc("audio"));
        if (sub != null) sub.setOnClickListener(v -> pickVlc("sub"));
        if (quality != null) quality.setOnClickListener(v -> pickVlc("video"));
        ImageView mute = findViewById(R.id.ctrlMute);
        if (mute != null) mute.setOnClickListener(v -> toggleMute());
        paintVol();
        if (seek != null) {
            seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
                @Override public void onProgressChanged(SeekBar s, int p, boolean fromUser) {}
                @Override public void onStartTrackingTouch(SeekBar s) { scrubbing = true; bump(); }
                @Override public void onStopTrackingTouch(SeekBar s) {
                    long dur = engineDur();
                    if (dur > 0) engineSeek(dur * s.getProgress() / 1000);
                    scrubbing = false;
                    bump();
                }
            });
        }
        GestureDetector gd = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onSingleTapConfirmed(MotionEvent e) {
                if (locked || swipeLive) return true;
                if (controlsOn) hideControls();
                else showControls();
                return true;
            }
            @Override public boolean onDoubleTap(MotionEvent e) {
                if (locked) return true;
                View surface = vlcLayout != null ? vlcLayout : playerView;
                if (surface == null) return true;
                float x = e.getX();
                int w = surface.getWidth();
                skip(x < w / 2f ? -10_000 : 10_000);
                showControls();
                return true;
            }
            @Override public boolean onDown(MotionEvent e) { return true; }
        });
        View.OnTouchListener surfaceTouch = (v, e) -> {
            boolean swiping = handleSwipe(v, e);
            int act = e.getActionMasked();
            if (!swiping || act == MotionEvent.ACTION_DOWN) gd.onTouchEvent(e);
            return true;
        };
        if (vlcLayout != null) vlcLayout.setOnTouchListener(surfaceTouch);
        else if (playerView != null) playerView.setOnTouchListener(surfaceTouch);
        cineControls.setOnTouchListener((v, e) -> {
            int act = e.getActionMasked();
            if (act == MotionEvent.ACTION_DOWN) {
                View hit = cineControls instanceof ViewGroup
                        ? findHit(cineControls, e.getRawX(), e.getRawY())
                        : cineControls;
                boolean empty = hit == null || hit == cineControls
                        || hit.getId() == R.id.ctrlScrimTop || hit.getId() == R.id.ctrlScrimBot
                        || hit.getId() == R.id.ctrlTop || hit.getId() == R.id.ctrlCenter
                        || hit.getId() == R.id.ctrlBottom || hit.getId() == R.id.ctrlLiveHint
                        || hit.getId() == R.id.ctrlGestureHud;
                gestIgnore = !empty;
                if (gestIgnore) return false;
            } else if (gestIgnore) return false;
            boolean swiping = handleSwipe(v, e);
            if (!swiping || act == MotionEvent.ACTION_DOWN) gd.onTouchEvent(e);
            return true;
        });
        paintPlay();
        showControls();
        ui.post(tick);
    }

    private View findHit(ViewGroup root, float rawX, float rawY) {
        int[] loc = new int[2];
        for (int i = root.getChildCount() - 1; i >= 0; i--) {
            View c = root.getChildAt(i);
            if (c.getVisibility() != View.VISIBLE) continue;
            c.getLocationOnScreen(loc);
            if (rawX >= loc[0] && rawX <= loc[0] + c.getWidth()
                    && rawY >= loc[1] && rawY <= loc[1] + c.getHeight()) {
                if (c instanceof ViewGroup) {
                    View inner = findHit((ViewGroup) c, rawX, rawY);
                    return inner != null ? inner : c;
                }
                return c;
            }
        }
        return null;
    }

    private boolean enginePlaying() {
        if (vlc != null) return vlc.isPlaying();
        return player != null && player.isPlaying();
    }

    private long enginePos() {
        if (vlc != null) return Math.max(0, vlc.getTime());
        return player == null ? 0 : Math.max(0, player.getCurrentPosition());
    }

    private long engineDur() {
        if (vlc != null) return Math.max(0, vlc.getLength());
        if (player == null) return 0;
        long d = player.getDuration();
        return (d <= 0 || d == C.TIME_UNSET) ? 0 : d;
    }

    private void engineSeek(long ms) {
        if (vlc != null) vlc.setTime(Math.max(0, ms));
        else if (player != null) player.seekTo(Math.max(0, ms));
    }

    private void applyVolume() {
        int v = Math.max(0, Math.min(200, volPct));
        if (vlc != null) {
            try { vlc.setVolume(v); } catch (Exception ignored) {}
        } else if (player != null) {
            try { player.setVolume(Math.min(1f, v / 100f)); } catch (Exception ignored) {}
        }
    }

    private void toggleMute() {
        if (volPct > 0) {
            lastVol = volPct;
            volPct = 0;
        } else {
            volPct = lastVol > 0 ? lastVol : 150;
        }
        applyVolume();
        paintVol();
        bump();
    }

    private void paintVol() {
        ImageView mute = findViewById(R.id.ctrlMute);
        if (mute != null) {
            mute.setImageResource(volPct <= 0 ? R.drawable.ic_volume_off : R.drawable.ic_volume);
            Ui.tint(mute, Color.WHITE);
        }
    }

    private boolean handleSwipe(View v, MotionEvent e) {
        int w = Math.max(1, v.getWidth());
        int h = Math.max(1, v.getHeight());
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                swipeLive = false;
                gestMode = 0;
                gestX = e.getX();
                gestY = e.getY();
                gestVol0 = volPct;
                gestBright0 = currentBright();
                gestSeek0 = enginePos();
                return false;
            case MotionEvent.ACTION_MOVE: {
                float dx = e.getX() - gestX;
                float dy = e.getY() - gestY;
                if (gestMode == 0) {
                    if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return false;
                    if (Math.abs(dy) > Math.abs(dx) * 1.15f) {
                        gestMode = gestX < w / 2f ? 2 : 1;
                        swipeLive = true;
                    } else if (!locked && seekAllowed()) {
                        gestMode = 3;
                        swipeLive = true;
                    } else {
                        gestMode = -1;
                        return false;
                    }
                }
                if (gestMode == 1) {
                    volPct = Math.max(0, Math.min(200, gestVol0 + Math.round(-dy / h * 180)));
                    if (volPct > 0) lastVol = volPct;
                    applyVolume();
                    paintVol();
                    showGestureHud(true, volPct);
                    return true;
                }
                if (gestMode == 2) {
                    windowBright = Math.max(0.01f, Math.min(1f, gestBright0 - dy / h));
                    applyBrightness();
                    showGestureHud(false, Math.round(windowBright * 100));
                    return true;
                }
                if (gestMode == 3 && seekAllowed()) {
                    long dur = engineDur();
                    long span = Math.min(Math.max(dur / 4, 30_000), 180_000);
                    long next = Math.max(0, Math.min(dur, gestSeek0 + Math.round(dx / (float) w * span)));
                    engineSeek(next);
                    showSeekHud(next, dur, next - gestSeek0);
                    return true;
                }
                return false;
            }
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL: {
                boolean was = swipeLive;
                swipeLive = false;
                gestMode = 0;
                hideGestureHudSoon();
                return was;
            }
            default:
                return swipeLive;
        }
    }

    private float currentBright() {
        if (windowBright > 0) return windowBright;
        float b = getWindow().getAttributes().screenBrightness;
        if (b >= 0) {
            windowBright = b;
            return b;
        }
        try {
            int sys = android.provider.Settings.System.getInt(getContentResolver(),
                    android.provider.Settings.System.SCREEN_BRIGHTNESS);
            windowBright = Math.max(0.01f, Math.min(1f, sys / 255f));
        } catch (Exception e) {
            windowBright = 0.5f;
        }
        return windowBright;
    }

    private void applyBrightness() {
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = Math.max(0.01f, Math.min(1f, windowBright));
        getWindow().setAttributes(lp);
    }

    private void showGestureHud(boolean volume, int pct) {
        View hud = findViewById(R.id.ctrlGestureHud);
        TextView t = findViewById(R.id.ctrlGesturePct);
        ImageView ic = findViewById(R.id.ctrlGestureIcon);
        if (hud == null) return;
        hud.setVisibility(View.VISIBLE);
        hud.bringToFront();
        if (t != null) t.setText(Math.max(0, Math.min(volume ? 200 : 100, pct)) + "%");
        if (ic != null) {
            ic.setImageResource(volume
                    ? (pct <= 0 ? R.drawable.ic_volume_off : R.drawable.ic_volume)
                    : R.drawable.ic_brightness);
            Ui.tint(ic, Color.WHITE);
        }
        ui.removeCallbacks(hideHud);
    }

    private void hideGestureHudSoon() {
        ui.removeCallbacks(hideHud);
        ui.postDelayed(hideHud, 800);
    }

    private final Runnable hideHud = () -> {
        View hud = findViewById(R.id.ctrlGestureHud);
        if (hud != null) hud.setVisibility(View.GONE);
    };

    private void showSeekHud(long pos, long dur, long delta) {
        View hud = findViewById(R.id.ctrlGestureHud);
        TextView t = findViewById(R.id.ctrlGesturePct);
        ImageView ic = findViewById(R.id.ctrlGestureIcon);
        if (hud == null) return;
        hud.setVisibility(View.VISIBLE);
        hud.bringToFront();
        String sign = delta < 0 ? "−" : "+";
        String line = sign + fmt(Math.abs(delta));
        if (dur > 0) line += "\n" + fmt(pos) + " / " + fmt(dur);
        if (t != null) t.setText(line);
        if (ic != null) {
            ic.setImageResource(delta < 0 ? R.drawable.ic_replay_10 : R.drawable.ic_forward_10);
            Ui.tint(ic, Color.WHITE);
        }
        ui.removeCallbacks(hideHud);
    }

    private void cycleSleep() {
        int[] opts = {0, 15, 30, 45, 60};
        int i = 0;
        for (int n = 0; n < opts.length; n++) if (opts[n] == sleepMins) { i = n; break; }
        sleepMins = opts[(i + 1) % opts.length];
        ui.removeCallbacks(sleepFire);
        if (sleepMins <= 0) {
            sleepAt = 0;
            Toast.makeText(this, "Sleep timer off", Toast.LENGTH_SHORT).show();
        } else {
            sleepAt = android.os.SystemClock.elapsedRealtime() + sleepMins * 60_000L;
            ui.postDelayed(sleepFire, sleepMins * 60_000L);
            Toast.makeText(this, sleepMins + " min baad player band", Toast.LENGTH_SHORT).show();
        }
        paintSleep();
        bump();
    }

    private void paintSleep() {
        TextView tv = findViewById(R.id.ctrlSleep);
        if (tv == null) return;
        if (sleepMins <= 0 || sleepAt <= 0) {
            tv.setText("Sleep");
            return;
        }
        long left = Math.max(0, sleepAt - android.os.SystemClock.elapsedRealtime());
        long m = left / 60_000;
        long s = (left / 1000) % 60;
        tv.setText(m > 0 ? ("Zzz " + m + "m") : ("Zzz " + s + "s"));
    }

    private final Runnable sleepFire = () -> {
        sleepMins = 0;
        sleepAt = 0;
        paintSleep();
        if (vlc != null && vlc.isPlaying()) vlc.pause();
        if (player != null) player.setPlayWhenReady(false);
        paintPlay();
        Toast.makeText(this, "Sleep timer — playback ruka", Toast.LENGTH_LONG).show();
        showControls();
    };

    private void togglePlay() {
        if (vlc != null) {
            if (vlc.isPlaying()) vlc.pause();
            else vlc.play();
        } else if (player != null) {
            player.setPlayWhenReady(!player.isPlaying());
        } else return;
        paintPlay();
        bump();
    }

    private boolean seekAllowed() {
        if (offlinePlay) return true;
        long dur = engineDur();
        return dur > 30_000;
    }

    private void skip(long ms) {
        if (!seekAllowed()) {
            flashSkip("LIVE");
            return;
        }
        long next = Math.max(0, enginePos() + ms);
        long dur = engineDur();
        if (dur > 0) next = Math.min(dur, next);
        engineSeek(next);
        flashSkip(ms < 0 ? "−10s" : "+10s");
        paintSeek();
        bump();
    }

    private void flashSkip(String label) {
        TextView flash = findViewById(R.id.ctrlSkipFlash);
        if (flash == null) return;
        flash.setText(label);
        flash.setVisibility(View.VISIBLE);
        ui.removeCallbacks(hideFlash);
        ui.postDelayed(hideFlash, 700);
    }

    private final Runnable hideFlash = () -> {
        TextView flash = findViewById(R.id.ctrlSkipFlash);
        if (flash != null) flash.setVisibility(View.GONE);
    };

    private void pickVlc(String kind) {
        if (vlc == null) {
            Toast.makeText(this, "Player is not ready", Toast.LENGTH_SHORT).show();
            return;
        }
        org.videolan.libvlc.MediaPlayer.TrackDescription[] tracks;
        int current;
        String title;
        if ("sub".equals(kind)) {
            tracks = vlc.getSpuTracks();
            current = vlc.getSpuTrack();
            title = "Subtitles";
        } else if ("video".equals(kind)) {
            tracks = vlc.getVideoTracks();
            current = vlc.getVideoTrack();
            title = "Quality";
        } else {
            tracks = vlc.getAudioTracks();
            current = vlc.getAudioTrack();
            title = "Audio / Language";
        }
        if (tracks == null || tracks.length == 0) {
            Toast.makeText(this, title + " tracks not found", Toast.LENGTH_SHORT).show();
            return;
        }
        String[] labels = new String[tracks.length];
        int[] ids = new int[tracks.length];
        for (int i = 0; i < tracks.length; i++) {
            ids[i] = tracks[i].id;
            String name = tracks[i].name == null || tracks[i].name.trim().isEmpty()
                    ? ("Track " + (i + 1)) : tracks[i].name;
            labels[i] = (tracks[i].id == current ? "●  " : "○  ") + name;
        }
        final String mode = kind;
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setItems(labels, (d, which) -> {
                    if (which < 0 || which >= ids.length) return;
                    if ("sub".equals(mode)) vlc.setSpuTrack(ids[which]);
                    else if ("video".equals(mode)) vlc.setVideoTrack(ids[which]);
                    else vlc.setAudioTrack(ids[which]);
                    bump();
                })
                .setNegativeButton("Close", null)
                .show();
        bump();
    }

    private void pickTrack(int type, String title) {
        if (vlc != null) {
            pickVlc(type == C.TRACK_TYPE_TEXT ? "sub" : "audio");
            return;
        }
        if (player == null) {
            Toast.makeText(this, "Player is not ready", Toast.LENGTH_SHORT).show();
            return;
        }
        Tracks tracks = player.getCurrentTracks();
        List<String> labels = new ArrayList<>();
        List<Runnable> actions = new ArrayList<>();
        if (type == C.TRACK_TYPE_TEXT) {
            labels.add("Off");
            actions.add(() -> player.setTrackSelectionParameters(
                    player.getTrackSelectionParameters().buildUpon()
                            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                            .build()));
        }
        int found = 0;
        for (Tracks.Group g : tracks.getGroups()) {
            if (g.getType() != type) continue;
            for (int i = 0; i < g.length; i++) {
                if (!g.isTrackSupported(i)) continue;
                Format f = g.getTrackFormat(i);
                String label = trackLabel(f, type, found);
                boolean on = g.isTrackSelected(i);
                labels.add((on ? "●  " : "○  ") + label);
                final int idx = i;
                final Tracks.Group group = g;
                actions.add(() -> player.setTrackSelectionParameters(
                        player.getTrackSelectionParameters().buildUpon()
                                .setTrackTypeDisabled(type, false)
                                .setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), idx))
                                .build()));
                found++;
            }
        }
        if (found == 0 && type != C.TRACK_TYPE_TEXT) {
            Toast.makeText(this, title + " tracks not found in this file", Toast.LENGTH_SHORT).show();
            return;
        }
        if (found == 0) {
            Toast.makeText(this, "No subtitles found", Toast.LENGTH_SHORT).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setItems(labels.toArray(new String[0]), (d, which) -> {
                    if (which >= 0 && which < actions.size()) actions.get(which).run();
                    bump();
                })
                .setNegativeButton("Close", null)
                .show();
        bump();
    }

    private static String trackLabel(Format f, int type, int idx) {
        String lang = f.language;
        String name = f.label;
        String bits = "";
        if (name != null && !name.trim().isEmpty()) bits = name.trim();
        else if (lang != null && !lang.isEmpty() && !"und".equalsIgnoreCase(lang)) {
            try { bits = new Locale(lang).getDisplayLanguage(Locale.ENGLISH); }
            catch (Exception e) { bits = lang; }
        }
        if (bits.isEmpty()) {
            bits = type == C.TRACK_TYPE_TEXT ? ("Subtitle " + (idx + 1)) : ("Track " + (idx + 1));
        }
        if (f.channelCount > 0 && type == C.TRACK_TYPE_AUDIO) {
            bits += f.channelCount >= 6 ? "  5.1" : (f.channelCount == 2 ? "  Stereo" : "");
        }
        return bits;
    }

    private void cycleSpeed() {
        if (vlc == null && player == null) return;
        speedIdx = (speedIdx + 1) % speeds.length;
        if (vlc != null) vlc.setRate(speeds[speedIdx]);
        else player.setPlaybackSpeed(speeds[speedIdx]);
        TextView tv = findViewById(R.id.ctrlSpeed);
        if (tv != null) {
            float s = speeds[speedIdx];
            tv.setText(s == (int) s ? ((int) s) + "x" : s + "x");
        }
        bump();
    }

    private void setLocked(boolean on) {
        locked = on;
        View unlock = findViewById(R.id.ctrlUnlock);
        if (unlock != null) unlock.setVisibility(on ? View.VISIBLE : View.GONE);
        if (on) hideControls();
        else showControls();
    }

    private void toggleFs() {
        cinema = !cinema;
        immersive(cinema);
        ImageView fs = findViewById(R.id.ctrlFs);
        if (fs != null) fs.setImageResource(cinema ? R.drawable.ic_fullscreen_exit : R.drawable.ic_fullscreen);
        bump();
    }

    private void showControls() {
        if (cineControls == null || locked) return;
        controlsOn = true;
        cineControls.setVisibility(View.VISIBLE);
        setBar(R.id.ctrlTop, View.VISIBLE);
        setBar(R.id.ctrlCenter, View.VISIBLE);
        setBar(R.id.ctrlBottom, View.VISIBLE);
        setBar(R.id.ctrlScrimTop, View.VISIBLE);
        setBar(R.id.ctrlScrimBot, View.VISIBLE);
        paintSeek();
        bump();
    }

    private void hideControls() {
        controlsOn = false;
        if (cineControls == null) return;
        if (locked) {
            setBar(R.id.ctrlTop, View.GONE);
            setBar(R.id.ctrlCenter, View.GONE);
            setBar(R.id.ctrlBottom, View.GONE);
            setBar(R.id.ctrlScrimTop, View.GONE);
            setBar(R.id.ctrlScrimBot, View.GONE);
            cineControls.setVisibility(View.VISIBLE);
            return;
        }
        cineControls.setVisibility(View.GONE);
    }

    private void setBar(int id, int vis) {
        View v = findViewById(id);
        if (v != null) v.setVisibility(vis);
    }

    private void bump() {
        ui.removeCallbacks(hideCtrl);
        if (controlsOn && !locked && enginePlaying()) {
            ui.postDelayed(hideCtrl, 4000);
        }
    }

    private void paintPlay() {
        ImageView play = findViewById(R.id.ctrlPlay);
        if (play == null || (vlc == null && player == null)) return;
        play.setImageResource(enginePlaying() ? R.drawable.ic_pause : R.drawable.ic_tr_play);
    }

    private void paintSeek() {
        if (!checkLocalRestriction()) return;
        if (vlc == null && player == null) return;
        long dur = engineDur();
        long pos = enginePos();
        long buf = player != null ? Math.max(0, player.getBufferedPosition()) : pos;
        TextView p = findViewById(R.id.ctrlPos);
        TextView d = findViewById(R.id.ctrlDur);
        SeekBar s = findViewById(R.id.ctrlSeek);
        boolean known = dur > 0 && dur != C.TIME_UNSET;
        if (p != null) p.setText(fmt(pos));
        if (d != null) d.setText(known ? fmt(dur) : (offlinePlay ? "--:--" : "LIVE"));
        if (s != null && !scrubbing) {
            s.setProgress(known ? (int) (pos * 1000 / dur) : 0);
            s.setSecondaryProgress(known ? (int) (buf * 1000 / dur) : 0);
        }
        paintSleep();
        if (vlc != null || player != null) ui.postDelayed(tick, 400);
    }

    private static String fmt(long ms) {
        long s = Math.max(0, ms) / 1000;
        long h = s / 3600;
        long m = (s % 3600) / 60;
        long sec = s % 60;
        if (h > 0) return String.format("%d:%02d:%02d", h, m, sec);
        return String.format("%d:%02d", m, sec);
    }

    private void startEmbed(String url, boolean hideProviderAds) {
        embedRequestUrl = url;
        this.hideProviderAds = hideProviderAds;
        int generation = ++embedGen;
        clearEmbed(false);
        EmbedRecoveryUi.clear(playerHost);
        ProgressBar spin = findViewById(R.id.watchProgress);
        spin.setVisibility(View.VISIBLE);
        Io.run(this, () -> Api.resolveEmbed(url), resolved -> {
            if (generation != embedGen) return;
            spin.setVisibility(View.GONE);
            if (resolved == null || resolved.isEmpty()) {
                showEmbedRecovery("Player link expired or unavailable. Retry or open the title again for a fresh link.");
                return;
            }
            attachWebView(resolved, hideProviderAds);
        }, e -> {
            if (generation != embedGen) return;
            spin.setVisibility(View.GONE);
            showEmbedRecovery(e instanceof Api.PlaybackAccessException ? e.getMessage() : "Embed failed. Retry or check your network.");
        });
    }

    private void clearEmbed(boolean rendererGone) {
        if (embedClient != null) embedClient.dispose();
        embedClient = null;
        hideCustomView();
        WebView old = webView;
        webView = null;
        EmbedRecoveryUi.destroy(old, rendererGone);
    }

    private void showEmbedRecovery(String message) {
        ProgressBar spin = findViewById(R.id.watchProgress);
        if (spin != null) spin.setVisibility(View.GONE);
        showError(message);
        EmbedRecoveryUi.show(playerHost, message, () -> {
            if (Io.alive(this)) startEmbed(embedRequestUrl, hideProviderAds);
        }, null);
    }

    private void showError(String msg) {
        TextView tv = findViewById(R.id.watchHint);
        if (tv != null) {
            tv.setText(msg);
            tv.setTextColor(Color.WHITE);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void attachWebView(String url, boolean hideProviderAds) {
        clearEmbed(false);
        EmbedRecoveryUi.clear(playerHost);
        WebView wv = new WebView(this);
        webView = wv;
        wv.setBackgroundColor(Color.BLACK);
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true);
        WebSecurity.harden(wv);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true);
        EmbedWebViewClient client = new EmbedWebViewClient(url, CineAmitApp.baseUrl(), hideProviderAds,
                new EmbedWebViewClient.Events() {
                    @Override public void ready(WebView view) {
                        if (view != webView || !Io.alive(PlayerActivity.this)) return;
                        showError("Fullscreen: use the fullscreen icon inside the player.");
                    }
                    @Override public void failed(WebView view, String message, boolean rendererGone) {
                        if (view != webView) return;
                        clearEmbed(rendererGone);
                        if (Io.alive(PlayerActivity.this)) showEmbedRecovery(message);
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
        wv.setOnTouchListener((v, e) -> {
            if (!v.hasFocus()) v.requestFocus();
            return false;
        });
        View overlay = findViewById(R.id.cineControls);
        if (overlay != null) overlay.setVisibility(View.GONE);
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
        fullscreenHost.removeAllViews();
        fullscreenHost.setVisibility(View.GONE);
        watchPage.setVisibility(View.VISIBLE);
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

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (chromeCustom != null || cinema) {
            hideCustomView();
            return;
        }
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT < 26 || AccessGate.blocked()) return;
        if (vlc == null && player == null && webView == null) return;
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
            watchPage.setVisibility(View.GONE);
            if (cineControls != null) cineControls.setVisibility(View.GONE);
        } else if (!cinema) {
            watchPage.setVisibility(View.VISIBLE);
            if (vlc != null || player != null) showControls();
            immersive(vlc != null || player != null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (pipAttempt || (Build.VERSION.SDK_INT >= 24 && isInPictureInPictureMode())) return;
        if (vlc != null && vlc.isPlaying()) vlc.pause();
        if (player != null) player.setPlayWhenReady(false);
        if (webView != null) webView.onPause();
    }

    private boolean checkLocalRestriction() {
        if (admittedLocalUrl==null || !OfflinePolicy.restricted()
                || in.cineamit.app.data.Downloads.localPlaybackStillAllowed(admittedLocalUrl)) return true;
        if (vlc!=null) {try {vlc.stop();} catch (Exception ignored) {}}
        if (player!=null) player.stop();
        android.widget.Toast.makeText(this,"Offline title is restricted for this profile.",android.widget.Toast.LENGTH_LONG).show();
        finish();return false;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!checkLocalRestriction()) return;
        if (webView != null) webView.onResume();
        if (cinema) immersive(true);
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(hideCtrl);
        ui.removeCallbacks(tick);
        ui.removeCallbacks(hideFlash);
        ui.removeCallbacks(hideHud);
        ui.removeCallbacks(sleepFire);
        embedGen++;
        clearEmbed(false);
        if (vlc != null) {
            try { vlc.stop(); } catch (Exception ignored) {}
            try { vlc.detachViews(); } catch (Exception ignored) {}
            try { vlc.release(); } catch (Exception ignored) {}
        }
        vlc = null;
        if (libVLC != null) {
            try { libVLC.release(); } catch (Exception ignored) {}
        }
        libVLC = null;
        if (player != null) player.release();
        player = null;
        super.onDestroy();
    }
}
