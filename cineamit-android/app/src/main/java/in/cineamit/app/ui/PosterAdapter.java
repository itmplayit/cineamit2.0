package in.cineamit.app.ui;

import android.graphics.drawable.GradientDrawable;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import in.cineamit.app.Images;
import in.cineamit.app.R;
import in.cineamit.app.data.Models.MediaItem;

public class PosterAdapter extends RecyclerView.Adapter<PosterAdapter.VH> {
    public interface OnOpen {
        void open(MediaItem item);
    }

    private final List<MediaItem> items = new ArrayList<>();
    private final OnOpen onOpen;
    private OnOpen onRemove;
    private final boolean grid;

    public PosterAdapter(OnOpen onOpen, boolean grid) {
        this.onOpen = onOpen;
        this.grid = grid;
    }

    public void setOnRemove(OnOpen onRemove) {
        this.onRemove = onRemove;
        notifyDataSetChanged();
    }

    public void setItems(List<MediaItem> next) {
        items.clear();
        if (next != null) items.addAll(next);
        notifyDataSetChanged();
    }

    public int addItems(List<MediaItem> extra) {
        if (extra == null || extra.isEmpty()) return 0;
        int start = items.size();
        int added = 0;
        for (MediaItem item : extra) {
            if (item == null) continue;
            boolean dup = false;
            for (MediaItem have : items) {
                if (have != null && have.id == item.id && String.valueOf(have.media_type).equals(String.valueOf(item.media_type))) {
                    dup = true;
                    break;
                }
            }
            if (dup) continue;
            items.add(item);
            added++;
        }
        if (added > 0) notifyItemRangeInserted(start, added);
        return added;
    }

    @NonNull
    @Override
    public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        int layout = grid ? R.layout.row_movie_item : R.layout.home_row_movie_item;
        View v = LayoutInflater.from(parent.getContext()).inflate(layout, parent, false);
        if (grid) {
            ViewGroup.LayoutParams lp = v.getLayoutParams();
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            v.setLayoutParams(lp);
        }
        return new VH(v);
    }

    @Override
    public void onBindViewHolder(@NonNull VH h, int position) {
        MediaItem item = items.get(position);
        if (!grid && h.poster != null) {
            int w = Ui.railPosterW(h.itemView.getContext());
            int ht = Math.round(w * 3f / 2f);
            ViewGroup.LayoutParams lp = h.poster.getLayoutParams();
            lp.width = w;
            lp.height = ht;
            h.poster.setLayoutParams(lp);
        }
        Images.loadPoster(h.poster, item);
        bindKind(h.kind, item);
        if (h.premium != null) {
            if (onRemove != null) {
                h.premium.setVisibility(View.VISIBLE);
                h.premium.setImageResource(R.drawable.ic_close_menu);
                h.premium.setOnClickListener(v -> onRemove.open(item));
                if (h.rating != null) h.rating.setVisibility(View.GONE);
            } else {
                h.premium.setVisibility(View.GONE);
                h.premium.setOnClickListener(null);
                bindRating(h.rating, item);
            }
        } else {
            bindRating(h.rating, item);
        }
        Motion.popIn(h.itemView, (position % 8) * 35L);
        Motion.press(h.itemView);
        h.itemView.setOnClickListener(v -> {
            if (onOpen != null) onOpen.open(item);
        });
        h.itemView.setOnLongClickListener(v -> {
            String type = item.media_type == null ? "" : item.media_type.toLowerCase();
            if ("person".equals(type) || "collection".equals(type)) return false;
            PosterPreview.show(v.getContext(), item);
            return true;
        });
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    @Override
    public void onViewRecycled(@NonNull VH h) {
        Motion.ensureVisible(h.itemView);
        super.onViewRecycled(h);
    }

    public static void bindKind(TextView tv, MediaItem item) {
        if (tv == null) return;
        if (item == null) {
            tv.setVisibility(View.GONE);
            return;
        }
        String type = item.media_type == null ? "movie" : item.media_type.toLowerCase();
        String label;
        int color;
        if ("person".equals(type)) {
            label = "Actor";
            color = 0xE6D97706;
        } else if ("collection".equals(type)) {
            tv.setVisibility(View.GONE);
            return;
        } else if (item.is_anime || "anime".equals(type)) {
            label = "Anime";
            color = 0xE69333EA;
        } else if ("tv".equals(type) || "show".equals(type) || "series".equals(type)) {
            label = "TV Show";
            color = 0xE62563EB;
        } else {
            label = "Movie";
            color = 0xE6DC2626;
        }
        tv.setVisibility(View.VISIBLE);
        tv.setText(label);
        GradientDrawable bg = new GradientDrawable();
        float r = 4f * tv.getResources().getDisplayMetrics().density;
        bg.setCornerRadius(r);
        bg.setColor(color);
        tv.setBackground(bg);
        tv.bringToFront();
    }

    static void bindRating(TextView tv, MediaItem item) {
        if (tv == null) return;
        if (item == null || item.vote_average <= 0 || "person".equalsIgnoreCase(item.media_type)) {
            tv.setVisibility(View.GONE);
            return;
        }
        tv.setVisibility(View.VISIBLE);
        tv.setText(String.format(java.util.Locale.US, "★ %.1f", item.vote_average));
        tv.bringToFront();
    }

    static class VH extends RecyclerView.ViewHolder {
        final ImageView poster;
        final ImageView premium;
        final TextView kind;
        final TextView rating;

        VH(View v) {
            super(v);
            ImageView image = v.findViewById(R.id.image);
            if (image == null) image = v.findViewById(R.id.poster);
            poster = image;
            View p = v.findViewById(R.id.ivPremium);
            premium = p instanceof ImageView ? (ImageView) p : null;
            kind = v.findViewById(R.id.kindBadge);
            rating = v.findViewById(R.id.ratingBadge);
        }
    }
}
