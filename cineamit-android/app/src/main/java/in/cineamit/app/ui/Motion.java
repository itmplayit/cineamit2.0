package in.cineamit.app.ui;

import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;

import in.cineamit.app.R;

public final class Motion {
    private Motion() {}

    public static void kenBurns(View v) {
        if (v == null) return;
        stop(v);
        v.setScaleX(1.04f);
        v.setScaleY(1.04f);
        v.setTranslationX(0f);
        v.setTranslationY(0f);
        ObjectAnimator sx = ObjectAnimator.ofFloat(v, View.SCALE_X, 1.04f, 1.08f);
        ObjectAnimator sy = ObjectAnimator.ofFloat(v, View.SCALE_Y, 1.04f, 1.08f);
        ObjectAnimator tx = ObjectAnimator.ofFloat(v, View.TRANSLATION_X, 0f, 12f);
        ObjectAnimator ty = ObjectAnimator.ofFloat(v, View.TRANSLATION_Y, 0f, -8f);
        for (ObjectAnimator a : new ObjectAnimator[]{sx, sy, tx, ty}) {
            a.setRepeatCount(ValueAnimator.INFINITE);
            a.setRepeatMode(ValueAnimator.REVERSE);
        }
        AnimatorSet set = new AnimatorSet();
        set.playTogether(sx, sy, tx, ty);
        set.setDuration(14000);
        set.setInterpolator(new AccelerateDecelerateInterpolator());
        v.setTag(R.id.tag_motion_anim, set);
        set.start();
    }

    public static void crossfade(View incoming, View outgoing, long ms) {
        if (incoming == null) return;
        incoming.animate().cancel();
        incoming.setVisibility(View.VISIBLE);
        incoming.setAlpha(0f);
        incoming.animate().alpha(1f).setDuration(ms)
                .setInterpolator(new DecelerateInterpolator()).start();
        if (outgoing != null && outgoing != incoming) {
            outgoing.animate().cancel();
            outgoing.animate().alpha(0f).setDuration(ms)
                    .setInterpolator(new DecelerateInterpolator()).start();
        }
    }

    public static void rise(View v, long delay) {
        if (v == null) return;
        v.animate().cancel();
        v.setAlpha(0f);
        v.setTranslationY(28f);
        v.animate().alpha(1f).translationY(0f).setDuration(520).setStartDelay(delay)
                .setInterpolator(new DecelerateInterpolator()).start();
    }

    public static void pulse(View v) {
        if (v == null) return;
        stop(v);
        ObjectAnimator x = ObjectAnimator.ofFloat(v, View.SCALE_X, 1f, 1.05f, 1f);
        ObjectAnimator y = ObjectAnimator.ofFloat(v, View.SCALE_Y, 1f, 1.05f, 1f);
        x.setRepeatCount(ValueAnimator.INFINITE);
        y.setRepeatCount(ValueAnimator.INFINITE);
        AnimatorSet set = new AnimatorSet();
        set.playTogether(x, y);
        set.setDuration(1600);
        v.setTag(R.id.tag_motion_anim, set);
        set.start();
    }

    public static void ensureVisible(View v) {
        if (v == null) return;
        v.animate().cancel();
        v.setAlpha(1f);
        v.setTranslationY(0f);
        v.setTranslationX(0f);
        v.setScaleX(1f);
        v.setScaleY(1f);
    }

    public static void fadeUp(View v, long delay) {
        if (v == null) return;
        if (Boolean.TRUE.equals(v.getTag(R.id.tag_motion_entered))) {
            ensureVisible(v);
            return;
        }
        v.setTag(R.id.tag_motion_entered, Boolean.TRUE);
        v.animate().cancel();
        v.setAlpha(0f);
        v.setTranslationY(18f);
        v.animate().alpha(1f).translationY(0f).setDuration(420).setStartDelay(delay)
                .setInterpolator(new DecelerateInterpolator()).start();
    }

    public static void popIn(View v, long delay) {
        if (v == null) return;
        if (Boolean.TRUE.equals(v.getTag(R.id.tag_motion_entered))) {
            ensureVisible(v);
            return;
        }
        v.setTag(R.id.tag_motion_entered, Boolean.TRUE);
        v.animate().cancel();
        v.setAlpha(0f);
        v.setScaleX(0.92f);
        v.setScaleY(0.92f);
        v.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(380).setStartDelay(delay)
                .setInterpolator(new OvershootInterpolator(1.4f)).start();
    }

    public static void shine(View v) {
        if (v == null) return;
        stop(v);
        ObjectAnimator a = ObjectAnimator.ofFloat(v, View.ALPHA, 0.45f, 1f, 0.45f);
        a.setRepeatCount(ValueAnimator.INFINITE);
        a.setDuration(2200);
        a.setInterpolator(new AccelerateDecelerateInterpolator());
        ObjectAnimator t = ObjectAnimator.ofFloat(v, View.TRANSLATION_X, 0f, 10f, 0f);
        t.setRepeatCount(ValueAnimator.INFINITE);
        t.setDuration(4200);
        t.setInterpolator(new AccelerateDecelerateInterpolator());
        AnimatorSet set = new AnimatorSet();
        set.playTogether(a, t);
        v.setTag(R.id.tag_motion_anim, set);
        set.start();
    }

    public static void enterIsland(View v) {
        if (v == null) return;
        if (Boolean.TRUE.equals(v.getTag(R.id.tag_motion_entered))) return;
        v.setTag(R.id.tag_motion_entered, Boolean.TRUE);
        v.animate().cancel();
        v.setAlpha(0f);
        v.setTranslationY(72f);
        v.setScaleX(0.92f);
        v.animate().alpha(1f).translationY(0f).scaleX(1f).setDuration(480)
                .setInterpolator(new OvershootInterpolator(0.9f))
                .start();
    }

    public static void press(View v) {
        if (v == null) return;
        if (Boolean.TRUE.equals(v.getTag(R.id.tag_motion_press))) return;
        v.setTag(R.id.tag_motion_press, Boolean.TRUE);
        final float[] start = new float[2];
        v.setOnTouchListener((view, ev) -> {
            int act = ev.getActionMasked();
            if (act == MotionEvent.ACTION_DOWN) {
                start[0] = ev.getRawX();
                start[1] = ev.getRawY();
                view.animate().cancel();
                view.animate().scaleX(0.94f).scaleY(0.94f).setDuration(90).start();
            } else if (act == MotionEvent.ACTION_MOVE) {
                float dx = ev.getRawX() - start[0];
                float dy = ev.getRawY() - start[1];
                if (dx * dx + dy * dy > 24f * 24f) {
                    view.animate().cancel();
                    view.animate().scaleX(1f).scaleY(1f).setDuration(120).start();
                }
            } else if (act == MotionEvent.ACTION_UP
                    || act == MotionEvent.ACTION_CANCEL
                    || act == MotionEvent.ACTION_OUTSIDE) {
                view.animate().cancel();
                view.animate().scaleX(1f).scaleY(1f).setDuration(160)
                        .setInterpolator(new OvershootInterpolator(1.6f)).start();
            }
            return false;
        });
    }

    public static void stagger(ViewGroup group, long startDelay) {
        if (group == null) return;
        int n = group.getChildCount();
        for (int i = 0; i < n; i++) {
            fadeUp(group.getChildAt(i), startDelay + i * 45L);
        }
    }

    public static void page(View root) {
        if (root == null) return;
        root.animate().cancel();
        root.setAlpha(0f);
        root.animate().alpha(1f).setDuration(280)
                .setInterpolator(new DecelerateInterpolator()).start();
    }

    public static void stop(View v) {
        if (v == null) return;
        Object t = v.getTag(R.id.tag_motion_anim);
        if (t instanceof AnimatorSet) ((AnimatorSet) t).cancel();
        v.animate().cancel();
    }
}
