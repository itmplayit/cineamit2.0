package in.cineamit.app.ui;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import in.cineamit.app.R;

public final class Ui {
    private Ui() {}

    public static final int ACCENT = 0xFFA78BFA;
    public static final int BOTTOM = 0xFF9E9E9E;
    public static final int CARD = 0xFF14151C;

    public static void tint(ImageView iv, int color) {
        iv.setImageTintList(ColorStateList.valueOf(color));
    }

    public static void padTopInset(View v) {
        if (v == null) return;
        if (Boolean.TRUE.equals(v.getTag(R.id.tag_pad_inset))) return;
        v.setTag(R.id.tag_pad_inset, Boolean.TRUE);
        final int orig = v.getPaddingTop();
        ViewCompat.setOnApplyWindowInsetsListener(v, (view, insets) -> {
            Insets sb = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            view.setPadding(view.getPaddingLeft(), orig + sb.top, view.getPaddingRight(), view.getPaddingBottom());
            return insets;
        });
        ViewCompat.requestApplyInsets(v);
    }

    public static void cineHeader(View root, String title, View.OnClickListener onBack) {
        TextView t = root.findViewById(R.id.browseTitle);
        if (t != null) t.setText(title);
        ImageView b = root.findViewById(R.id.btnBack);
        if (b != null) {
            tint(b, Color.WHITE);
            if (onBack != null) b.setOnClickListener(onBack);
        }
        View top = root.findViewById(R.id.cineHeaderTop);
        if (top == null && b != null && b.getParent() instanceof View) top = (View) b.getParent();
        padTopInset(top);
    }

    public static void toolbar(View root, String title, boolean back, View.OnClickListener onBack, boolean search, View.OnClickListener onSearch) {
        TextView t = root.findViewById(R.id.toolbarTitle);
        if (t != null) t.setText(title);
        ImageView b = root.findViewById(R.id.btnBack);
        if (b != null) {
            b.setVisibility(back ? View.VISIBLE : View.GONE);
            tint(b, Color.WHITE);
            if (onBack != null) b.setOnClickListener(onBack);
        }
        ImageView s = root.findViewById(R.id.btnSearch);
        if (s != null) {
            s.setVisibility(search ? View.VISIBLE : View.GONE);
            tint(s, Color.WHITE);
            if (onSearch != null) s.setOnClickListener(onSearch);
        }
    }

    public static TextView chip(Context ctx, String label, boolean selected, View.OnClickListener click) {
        TextView tv = (TextView) LayoutInflater.from(ctx).inflate(R.layout.item_chip, new LinearLayout(ctx), false);
        tv.setText(label);
        tv.setBackgroundResource(selected ? R.drawable.chip_on : R.drawable.chip_bg);
        tv.setTextColor(selected ? 0xFFC4B5FD : 0xFFF4F1EA);
        tv.setOnClickListener(click);
        Motion.press(tv);
        return tv;
    }

    public static void show(View v, boolean on) {
        if (v != null) v.setVisibility(on ? View.VISIBLE : View.GONE);
    }

    public static int widthDp(Context ctx) {
        android.util.DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
        return Math.round(dm.widthPixels / dm.density);
    }

    /** Poster grid columns: 2 on small phones, 3 on normal, 4–5 on tablet. */
    public static int posterSpan(Context ctx) {
        int w = widthDp(ctx);
        if (w >= 720) return 5;
        if (w >= 600) return 4;
        if (w >= 360) return 3;
        return 2;
    }

    public static int liveSpan(Context ctx) {
        int w = widthDp(ctx);
        if (w >= 720) return 4;
        if (w >= 500) return 3;
        return 2;
    }

    public static androidx.recyclerview.widget.GridLayoutManager posterGrid(Context ctx) {
        return new androidx.recyclerview.widget.GridLayoutManager(ctx, posterSpan(ctx));
    }

    public static int railPosterW(Context ctx) {
        android.util.DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
        int span = posterSpan(ctx);
        int pad = Math.round(20 * dm.density);
        int w = Math.round((dm.widthPixels - pad) / (span + 0.32f));
        int min = Math.round(96 * dm.density);
        int max = Math.round(200 * dm.density);
        return Math.max(min, Math.min(max, w));
    }

    public static void sizeHeroFrame(View frame) {
        if (frame == null) return;
        android.util.DisplayMetrics dm = frame.getResources().getDisplayMetrics();
        int screenW = dm.widthPixels;
        if (frame.getParent() instanceof View) {
            int pw = ((View) frame.getParent()).getWidth();
            if (pw > 8) screenW = pw;
        }
        int wdp = Math.round(screenW / dm.density);
        float frac = wdp >= 600 ? 0.36f : (wdp < 360 ? 0.50f : 0.56f);
        int min = Math.round((wdp < 360 ? 132 : 156) * dm.density);
        int max = Math.round((wdp >= 600 ? 280 : 228) * dm.density);
        int w = Math.max(min, Math.min(max, Math.round(screenW * frac)));
        int h = Math.round(w * 1.5f);
        android.view.ViewGroup.LayoutParams lp = frame.getLayoutParams();
        if (lp == null) return;
        lp.width = w;
        lp.height = h;
        if (lp instanceof android.widget.FrameLayout.LayoutParams) {
            ((android.widget.FrameLayout.LayoutParams) lp).gravity = android.view.Gravity.CENTER_HORIZONTAL;
        }
        frame.setLayoutParams(lp);
        frame.setClipToOutline(true);
    }

    /** Bottom padding so island + nav bar don't cover the last row. */
    public static void padForIsland(View v) {
        padBottom(v, 88);
    }

    /** Banner + nav only — screens without island (Actors, Plans). */
    public static void padForBanner(View v) {
        padBottom(v, 12);
    }

    private static void padBottom(View v, int chromeDp) {
        if (v == null) return;
        if (Boolean.TRUE.equals(v.getTag(R.id.tag_pad_island))) return;
        v.setTag(R.id.tag_pad_island, Boolean.TRUE);
        final int left = v.getPaddingLeft();
        final int top = v.getPaddingTop();
        final int right = v.getPaddingRight();
        ViewCompat.setOnApplyWindowInsetsListener(v, (view, insets) -> {
            int nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
            int extra = Math.round((chromeDp + in.cineamit.app.Ads.bannerReserveDp()) * view.getResources().getDisplayMetrics().density);
            view.setPadding(left, top, right, extra + nav);
            return insets;
        });
        ViewCompat.requestApplyInsets(v);
    }
}
