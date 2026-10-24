package in.cineamit.app;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Picture;
import android.graphics.PorterDuff;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.util.LruCache;
import android.widget.ImageView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.bumptech.glide.Glide;
import com.bumptech.glide.Priority;
import com.bumptech.glide.load.DataSource;
import com.bumptech.glide.load.DecodeFormat;
import com.bumptech.glide.load.engine.DiskCacheStrategy;
import com.bumptech.glide.load.engine.GlideException;
import com.bumptech.glide.load.engine.bitmap_recycle.BitmapPool;
import com.bumptech.glide.load.resource.bitmap.BitmapTransformation;
import com.bumptech.glide.request.RequestListener;
import com.bumptech.glide.request.RequestOptions;
import com.bumptech.glide.request.target.Target;

import java.security.MessageDigest;
import com.caverock.androidsvg.PreserveAspectRatio;
import com.caverock.androidsvg.SVG;

import org.json.JSONObject;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.MediaItem;
import in.cineamit.app.data.Models.Session;

import okhttp3.Request;
import okhttp3.Response;

public final class Images {
    private static final LruCache<String, Bitmap> LOGO_BMP = new LruCache<>(16);

    private Images() {}

    private static RequestOptions hd() {
        return new RequestOptions()
                .format(DecodeFormat.PREFER_ARGB_8888)
                .diskCacheStrategy(DiskCacheStrategy.DATA)
                .dontAnimate();
    }

    public static void load(ImageView view, String url) {
        load(view, url, R.drawable.place_holder_movie);
    }

    /** Big 2:3 portrait poster for the home hero. */
    public static void loadHero(ImageView view, String path, Runnable onReady) {
        if (view == null) return;
        final String thumbUrl = Api.img(Session.imageBase, path, "w500");
        String fullUrl = Api.img(Session.imageBase, path, "w780");
        if (fullUrl == null || fullUrl.isEmpty()) fullUrl = thumbUrl;
        if (fullUrl == null || fullUrl.isEmpty()) {
            if (onReady != null) onReady.run();
            return;
        }
        final String heroUrl = fullUrl;
        final Runnable done = onReady;
        Runnable go = () -> {
            android.content.Context ctx = view.getContext();
            if (ctx == null) return;
            int w = view.getWidth();
            int h = view.getHeight();
            if (w < 8) w = view.getResources().getDisplayMetrics().widthPixels;
            if (h < 8) h = Math.round(w * 3f / 2f);
            Drawable keep = view.getDrawable();
            Glide.with(ctx)
                    .load(heroUrl)
                    .thumbnail(Glide.with(ctx).load(thumbUrl).apply(hd()).centerCrop())
                    .apply(hd())
                    .centerCrop()
                    .placeholder(keep)
                    .override(w, h)
                    .priority(Priority.IMMEDIATE)
                    .listener(new RequestListener<Drawable>() {
                        @Override
                        public boolean onLoadFailed(@Nullable GlideException e, Object model, Target<Drawable> target, boolean isFirstResource) {
                            if (done != null) view.post(done);
                            return false;
                        }

                        @Override
                        public boolean onResourceReady(Drawable resource, Object model, Target<Drawable> target, DataSource dataSource, boolean isFirstResource) {
                            if (done != null) view.post(done);
                            return false;
                        }
                    })
                    .into(view);
        };
        if (view.getWidth() > 8 && view.getHeight() > 8) go.run();
        else view.post(go);
    }

    /** Scale-to-fill, crop sides, keep the TOP of the still (sky / faces), not the centre. */
    public static final class TopCrop extends BitmapTransformation {
        private static final String ID = "in.cineamit.app.Images.TopCrop.2";
        private static final byte[] ID_BYTES = ID.getBytes(CHARSET);

        @Override
        protected Bitmap transform(@NonNull BitmapPool pool, @NonNull Bitmap toTransform, int outWidth, int outHeight) {
            if (outWidth <= 0 || outHeight <= 0) return toTransform;
            if (toTransform.getWidth() == outWidth && toTransform.getHeight() == outHeight) return toTransform;
            float scale = Math.max(outWidth / (float) toTransform.getWidth(), outHeight / (float) toTransform.getHeight());
            int scaledW = Math.max(1, Math.round(toTransform.getWidth() * scale));
            int scaledH = Math.max(1, Math.round(toTransform.getHeight() * scale));
            Bitmap scaled = Bitmap.createScaledBitmap(toTransform, scaledW, scaledH, true);
            int x = Math.max(0, (scaledW - outWidth) / 2);
            int y = 0;
            int cw = Math.min(outWidth, scaled.getWidth() - x);
            int ch = Math.min(outHeight, scaled.getHeight() - y);
            if (cw <= 0 || ch <= 0) return toTransform;
            Bitmap cropped = Bitmap.createBitmap(scaled, x, y, cw, ch);
            if (scaled != toTransform && scaled != cropped) scaled.recycle();
            return cropped;
        }

        @Override
        public void updateDiskCacheKey(@NonNull MessageDigest messageDigest) {
            messageDigest.update(ID_BYTES);
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof TopCrop;
        }

        @Override
        public int hashCode() {
            return ID.hashCode();
        }
    }

    public static void preload(String url) {
        if (url == null || url.isEmpty() || CineAmitApp.get() == null) return;
        Glide.with(CineAmitApp.get()).load(url).apply(hd()).preload();
    }

    /** Logos (providers / studios): contain, never crop, never tint. */
    public static void loadContain(ImageView view, String url, Runnable onReady, Runnable onFail) {
        if (view == null) return;
        if (url == null || url.isEmpty() || "null".equalsIgnoreCase(url)) {
            view.setImageDrawable(null);
            view.setVisibility(ImageView.GONE);
            if (onFail != null) onFail.run();
            return;
        }
        view.setVisibility(ImageView.VISIBLE);
        view.clearColorFilter();
        android.content.Context ctx = view.getContext();
        if (ctx == null) return;
        Glide.with(ctx)
                .load(url)
                .apply(hd())
                .fitCenter()
                .listener(new RequestListener<Drawable>() {
                    @Override
                    public boolean onLoadFailed(@Nullable GlideException e, Object model, @NonNull Target<Drawable> target, boolean isFirstResource) {
                        view.setVisibility(ImageView.GONE);
                        if (onFail != null) onFail.run();
                        return true;
                    }
                    @Override
                    public boolean onResourceReady(@NonNull Drawable resource, @NonNull Object model, Target<Drawable> target, @NonNull DataSource dataSource, boolean isFirstResource) {
                        view.setVisibility(ImageView.VISIBLE);
                        if (onReady != null) onReady.run();
                        return false;
                    }
                })
                .into(view);
    }

    public static void load(ImageView view, String url, int placeholder) {
        if (view == null) return;
        if (url == null || url.isEmpty() || "null".equals(url)) {
            if (placeholder != 0) view.setImageResource(placeholder);
            return;
        }
        view.clearColorFilter();
        Glide.with(view.getContext())
                .load(url)
                .apply(hd())
                .centerCrop()
                .placeholder(placeholder == 0 ? android.R.color.transparent : placeholder)
                .error(placeholder == 0 ? android.R.color.transparent : placeholder)
                .into(view);
    }

    public static String artPath(MediaItem item) {
        if (item == null) return "";
        if (item.poster_path != null && !item.poster_path.isEmpty() && !"null".equalsIgnoreCase(item.poster_path)) {
            return item.poster_path;
        }
        if (item.backdrop_path != null && !item.backdrop_path.isEmpty() && !"null".equalsIgnoreCase(item.backdrop_path)) {
            return item.backdrop_path;
        }
        return "";
    }

    /** Rails / grid: poster first, backdrop fallback. Never original — that 4K decode blanks some tiles. */
    public static void loadPoster(ImageView view, MediaItem item) {
        loadPoster(view, item, R.drawable.place_holder_movie);
    }

    public static void loadPoster(ImageView view, MediaItem item, int placeholder) {
        if (view == null) return;
        String path = artPath(item);
        String url = Api.img(Session.imageBase, path, "w500");
        String thumb = Api.img(Session.imageBase, path, "w185");
        if (url == null || url.isEmpty()) {
            if (placeholder != 0) view.setImageResource(placeholder);
            return;
        }
        view.clearColorFilter();
        android.content.Context ctx = view.getContext();
        int w = view.getWidth();
        int h = view.getHeight();
        com.bumptech.glide.RequestBuilder<Drawable> req = Glide.with(ctx)
                .load(url)
                .apply(hd())
                .centerCrop()
                .placeholder(placeholder == 0 ? android.R.color.transparent : placeholder)
                .error(placeholder == 0 ? android.R.color.transparent : placeholder)
                .priority(Priority.HIGH);
        if (thumb != null && !thumb.isEmpty() && !thumb.equals(url)) {
            req = req.thumbnail(Glide.with(ctx).load(thumb).apply(hd()).centerCrop());
        }
        if (w > 8 && h > 8) req = req.override(w, h);
        req.into(view);
    }

    public static String logoUrl(String path) {
        return Api.img(Session.imageBase, path, "w500");
    }

    public static void prefetchHeroLogos(java.util.List<MediaItem> items) {
        if (items == null) return;
        for (MediaItem item : items) {
            if (item == null) continue;
            Io.run(() -> warmItem(item), url -> {}, e -> {});
        }
    }

    private static String warmItem(MediaItem item) throws Exception {
        String path = item.logo_path;
        if (path == null || path.isEmpty()) {
            JSONObject json = Api.titleLogo(item.media_type, item.id);
            path = json.optString("logo_path");
            if ("null".equalsIgnoreCase(path)) path = "";
            item.logo_path = path;
        }
        String url = logoUrl(path);
        if (url == null || url.isEmpty()) return "";
        if (LOGO_BMP.get(url) != null) return url;
        if (url.toLowerCase().contains(".svg")) {
            Bitmap bmp = decodeSvg(url);
            if (bmp != null) LOGO_BMP.put(url, bmp);
        } else if (CineAmitApp.get() != null) {
            Glide.with(CineAmitApp.get())
                    .load(url)
                    .apply(hd())
                    .priority(Priority.HIGH)
                    .preload();
        }
        return url;
    }

    public static void loadLogo(ImageView view, String url, Runnable onOk, Runnable onFail) {
        if (view == null) {
            if (onFail != null) onFail.run();
            return;
        }
        if (url == null || url.isEmpty() || "null".equals(url)) {
            view.setImageDrawable(null);
            if (onFail != null) onFail.run();
            return;
        }
        Bitmap cached = LOGO_BMP.get(url);
        if (cached != null && !cached.isRecycled()) {
            view.setImageBitmap(cached);
            paintTitleLogo(view);
            if (onOk != null) onOk.run();
            return;
        }
        if (url.toLowerCase().contains(".svg")) {
            loadSvg(view, url, onOk, onFail);
            return;
        }
        Glide.with(view.getContext())
                .load(url)
                .apply(hd())
                .priority(Priority.IMMEDIATE)
                .listener(new RequestListener<Drawable>() {
                    @Override
                    public boolean onLoadFailed(@Nullable GlideException e, Object model, Target<Drawable> target, boolean isFirstResource) {
                        if (onFail != null) view.post(onFail);
                        return false;
                    }

                    @Override
                    public boolean onResourceReady(Drawable resource, Object model, Target<Drawable> target, DataSource dataSource, boolean isFirstResource) {
                        view.post(() -> {
                            paintTitleLogo(view);
                            if (onOk != null) onOk.run();
                        });
                        return false;
                    }
                })
                .into(view);
    }

    public static void paintTitleLogo(ImageView view) {
        if (view == null) return;
        view.clearColorFilter();
        Drawable d = view.getDrawable();
        Bitmap bmp = null;
        if (d instanceof BitmapDrawable) bmp = ((BitmapDrawable) d).getBitmap();
        if (bmp == null || bmp.isRecycled()) return;
        if (isDarkMonoLogo(bmp)) {
            view.setColorFilter(Color.WHITE, PorterDuff.Mode.SRC_IN);
        }
    }

    /** Black/grey TMDB wordmarks vanish on the dark hero — those only get a white tint. Coloured logos stay as-is. */
    private static boolean isDarkMonoLogo(Bitmap bmp) {
        int w = bmp.getWidth();
        int h = bmp.getHeight();
        if (w < 4 || h < 4) return false;
        int stepX = Math.max(1, w / 28);
        int stepY = Math.max(1, h / 28);
        long rSum = 0, gSum = 0, bSum = 0;
        int n = 0, colorful = 0;
        try {
            for (int y = 0; y < h; y += stepY) {
                for (int x = 0; x < w; x += stepX) {
                    int c = bmp.getPixel(x, y);
                    int a = (c >>> 24) & 0xFF;
                    if (a < 48) continue;
                    int r = (c >> 16) & 0xFF;
                    int g = (c >> 8) & 0xFF;
                    int b = c & 0xFF;
                    rSum += r;
                    gSum += g;
                    bSum += b;
                    n++;
                    int max = Math.max(r, Math.max(g, b));
                    int min = Math.min(r, Math.min(g, b));
                    if (max - min > 30) colorful++;
                }
            }
        } catch (Exception e) {
            return false;
        }
        if (n < 8) return false;
        if (colorful * 6 > n) return false;
        int avg = (int) ((rSum + gSum + bSum) / (3L * n));
        return avg < 170;
    }

    private static void loadSvg(ImageView view, String url, Runnable onOk, Runnable onFail) {
        Io.run(() -> decodeSvg(url), bmp -> {
            if (view.getWindowToken() == null) return;
            if (bmp == null) {
                if (onFail != null) onFail.run();
                return;
            }
            LOGO_BMP.put(url, bmp);
            view.setImageBitmap(bmp);
            paintTitleLogo(view);
            if (onOk != null) onOk.run();
        }, e -> {
            if (view.getWindowToken() == null) return;
            if (onFail != null) onFail.run();
        });
    }

    @Nullable
    private static Bitmap decodeSvg(String url) throws Exception {
        Bitmap hit = LOGO_BMP.get(url);
        if (hit != null && !hit.isRecycled()) return hit;
        Request req = new Request.Builder().url(url)
                .header("User-Agent", "Mozilla/5.0")
                .header("Accept", "image/svg+xml,image/*,*/*")
                .build();
        try (Response res = Api.client().newCall(req).execute()) {
            if (!res.isSuccessful() || res.body() == null) return null;
            SVG svg = SVG.getFromInputStream(res.body().byteStream());
            float density = CineAmitApp.get().getResources().getDisplayMetrics().density;
            float maxW = 280f * density;
            float maxH = 96f * density;
            svg.setDocumentPreserveAspectRatio(PreserveAspectRatio.LETTERBOX);
            svg.setDocumentWidth(maxW);
            svg.setDocumentHeight(maxH);
            Picture picture = svg.renderToPicture(Math.round(maxW), Math.round(maxH));
            int pw = Math.max(picture.getWidth(), Math.round(maxW));
            int ph = Math.max(picture.getHeight(), Math.round(maxH));
            Bitmap bmp = Bitmap.createBitmap(pw, ph, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            canvas.drawPicture(picture);
            if (bmp.getWidth() < 8 || bmp.getHeight() < 8) return null;
            return bmp;
        }
    }
}
