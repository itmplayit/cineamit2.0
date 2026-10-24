package in.cineamit.app.ui;

import android.app.Dialog;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import in.cineamit.app.CineAmitApp;
import in.cineamit.app.DetailsActivity;
import in.cineamit.app.Images;
import in.cineamit.app.Io;
import in.cineamit.app.R;
import in.cineamit.app.WatchActivity;
import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.MediaItem;

public final class PosterPreview {
    private PosterPreview() {}

    public static void show(Context ctx, MediaItem item) {
        if (ctx == null || item == null) return;
        String type = item.media_type == null ? "movie" : item.media_type;
        if ("person".equalsIgnoreCase(type) || "collection".equalsIgnoreCase(type)) {
            if (ctx instanceof android.app.Activity) {
                // fall through to normal open
            }
            return;
        }
        Dialog d = new Dialog(ctx, android.R.style.Theme_Translucent_NoTitleBar);
        d.setContentView(R.layout.dialog_poster_preview);
        Window w = d.getWindow();
        if (w != null) {
            w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            w.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT);
            w.setGravity(Gravity.CENTER);
            w.setDimAmount(0.72f);
        }
        ImageView poster = d.findViewById(R.id.previewPoster);
        TextView kind = d.findViewById(R.id.previewKind);
        TextView title = d.findViewById(R.id.previewTitle);
        TextView meta = d.findViewById(R.id.previewMeta);
        TextView overview = d.findViewById(R.id.previewOverview);
        Images.loadPoster(poster, item);
        PosterAdapter.bindKind(kind, item);
        if (title != null) title.setText(item.title);
        String bits = "";
        if (item.vote_average > 0) bits = String.format(java.util.Locale.US, "★ %.1f", item.vote_average);
        if (item.year != null && !item.year.isEmpty()) bits = bits.isEmpty() ? item.year : bits + "  ·  " + item.year;
        if (meta != null) meta.setText(bits);
        if (overview != null) {
            boolean empty = item.overview == null || item.overview.trim().isEmpty();
            overview.setVisibility(empty ? android.view.View.GONE : android.view.View.VISIBLE);
            if (!empty) overview.setText(item.overview);
        }
        d.findViewById(R.id.previewInfo).setOnClickListener(v -> {
            d.dismiss();
            DetailsActivity.open(ctx, type, item.id);
        });
        d.findViewById(R.id.previewWatch).setOnClickListener(v -> {
            d.dismiss();
            Runnable go = () -> WatchActivity.open(ctx, type, item.id, item.title, 1, 1);
            if (ctx instanceof android.app.Activity) {
                in.cineamit.app.Ads.showInterstitial((android.app.Activity) ctx, go);
            } else go.run();
        });
        d.findViewById(R.id.previewTrailer).setOnClickListener(v -> {
            if (!(ctx instanceof android.app.Activity)) return;
            android.app.Activity act = (android.app.Activity) ctx;
            Io.run(act, () -> Api.trailer(type, item.id), json -> {
                String key = json.optString("key");
                if (key == null || key.isEmpty() || "null".equalsIgnoreCase(key)) {
                    Toast.makeText(ctx, "Trailer not found.", Toast.LENGTH_SHORT).show();
                    return;
                }
                try {
                    ctx.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=" + key)));
                } catch (Exception e) {
                    Toast.makeText(ctx, "YouTube could not open.", Toast.LENGTH_SHORT).show();
                }
            }, e -> Toast.makeText(ctx, CineAmitApp.friendlyNetError(e), Toast.LENGTH_SHORT).show());
        });
        Motion.press(d.findViewById(R.id.previewInfo));
        Motion.press(d.findViewById(R.id.previewWatch));
        Motion.press(d.findViewById(R.id.previewTrailer));
        d.show();
    }
}
