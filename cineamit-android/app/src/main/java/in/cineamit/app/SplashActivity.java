package in.cineamit.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import in.cineamit.app.ui.Motion;

public class SplashActivity extends AppCompatActivity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable go = this::openNext;
    private boolean opened;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (bars != null) {
            bars.setAppearanceLightStatusBars(false);
            bars.hide(WindowInsetsCompat.Type.navigationBars());
            bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
        getWindow().setStatusBarColor(0x00000000);
        getWindow().setNavigationBarColor(0xFF0A0612);
        setContentView(R.layout.activity_splash);

        View glow = findViewById(R.id.splashGlow);
        View ring = findViewById(R.id.splashRing);
        View logo = findViewById(R.id.splashLogo);
        View name = findViewById(R.id.splashName);
        View tag = findViewById(R.id.splashTag);
        View footer = findViewById(R.id.splashFooter);
        View bar = findViewById(R.id.splashBar);

        if (glow != null) {
            glow.setAlpha(0f);
            glow.setScaleX(0.72f);
            glow.setScaleY(0.72f);
            glow.animate().alpha(0.9f).scaleX(1f).scaleY(1f).setDuration(900)
                    .setInterpolator(new DecelerateInterpolator()).start();
            Motion.pulse(glow);
        }
        if (ring != null) {
            ring.setAlpha(0f);
            ring.setScaleX(0.84f);
            ring.setScaleY(0.84f);
            ring.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(620)
                    .setInterpolator(new OvershootInterpolator(1.1f)).start();
            Motion.pulse(ring);
        }
        if (logo != null) {
            logo.setAlpha(0f);
            logo.setScaleX(0.72f);
            logo.setScaleY(0.72f);
            logo.animate().alpha(1f).scaleX(1f).scaleY(1f).setStartDelay(90).setDuration(640)
                    .setInterpolator(new OvershootInterpolator(1.35f)).start();
        }
        Motion.fadeUp(name, 280);
        Motion.fadeUp(tag, 420);
        Motion.fadeUp(footer, 560);
        if (bar != null) {
            bar.setScaleX(0f);
            bar.post(() -> {
                bar.setPivotX(0f);
                bar.animate().scaleX(1f).setStartDelay(400).setDuration(1550)
                        .setInterpolator(new DecelerateInterpolator()).start();
            });
        }

        findViewById(R.id.splashRoot).setOnClickListener(v -> openNext());
        handler.postDelayed(go, 2300);
    }

    private void openNext() {
        if (opened || isFinishing()) return;
        if (AccessGate.blocked() || CineAmitApp.foreground() != this) { handler.removeCallbacks(go); handler.postDelayed(go, 1500); return; }
        opened = true;
        handler.removeCallbacks(go);
        boolean guest = CineAmitApp.prefs().getBoolean("guest_ok", false);
        Intent next;
        if (in.cineamit.app.data.Models.Session.user != null || guest) {
            next = new Intent(this, MainActivity.class);
        } else {
            next = new Intent(this, LoginActivity.class).putExtra("from_splash", true);
        }
        startActivity(next);
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
        finish();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(go);
        Motion.stop(findViewById(R.id.splashGlow));
        Motion.stop(findViewById(R.id.splashRing));
        super.onDestroy();
    }
}
