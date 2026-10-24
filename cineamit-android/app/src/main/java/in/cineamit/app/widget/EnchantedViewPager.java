package in.cineamit.app.widget;

import android.content.Context;
import android.util.AttributeSet;

import androidx.viewpager.widget.ViewPager;

public class EnchantedViewPager extends ViewPager {
    public EnchantedViewPager(Context context) {
        super(context);
        useLargeHero();
    }

    public EnchantedViewPager(Context context, AttributeSet attrs) {
        super(context, attrs);
        useLargeHero();
    }

    public void useLargeHero() {
        float d = getResources().getDisplayMetrics().density;
        int pad = Math.round(16 * d);
        setClipToPadding(false);
        setClipChildren(false);
        setPadding(pad, 0, pad, 0);
        setPageMargin(Math.round(12 * d));
        setOffscreenPageLimit(3);
        setPageTransformer(false, (page, position) -> {
            float abs = Math.min(1f, Math.abs(position));
            float scale = 0.94f + (1f - abs) * 0.06f;
            page.setScaleY(scale);
            page.setScaleX(scale);
            page.setAlpha(0.45f + (1f - abs) * 0.55f);
            page.setTranslationZ((1f - abs) * 8f);
        });
    }
}
