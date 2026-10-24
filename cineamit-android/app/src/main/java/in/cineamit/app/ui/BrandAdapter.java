package in.cineamit.app.ui;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import in.cineamit.app.CatalogActivity;
import in.cineamit.app.Images;
import in.cineamit.app.R;
import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.Provider;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.data.Models.Studio;

public class BrandAdapter extends RecyclerView.Adapter<BrandAdapter.VH> {
    public interface Click { void on(Item item); }

    public static final class Item {
        public final long id;
        public final String name;
        public final String imageUrl;
        public final boolean studio;
        Item(long id, String name, String imageUrl, boolean studio) {
            this.id = id;
            this.name = name == null ? "" : name;
            this.imageUrl = imageUrl == null ? "" : imageUrl;
            this.studio = studio;
        }
    }

    private final List<Item> data;
    private final Click click;
    private final boolean fillWidth;

    public BrandAdapter(List<Item> data, boolean fillWidth, Click click) {
        this.data = data == null ? new ArrayList<>() : data;
        this.fillWidth = fillWidth;
        this.click = click;
    }

    public static BrandAdapter providers(List<Provider> list, boolean fill, Click click) {
        List<Item> items = new ArrayList<>();
        if (list != null) {
            for (Provider p : list) {
                if (p == null || p.provider_id <= 0) continue;
                String url = Api.img(Session.imageBase, p.logo_path, "w185");
                items.add(new Item(p.provider_id, p.provider_name, url, false));
            }
        }
        return new BrandAdapter(items, fill, click);
    }

    public static BrandAdapter studios(List<Studio> list, boolean fill, Click click) {
        List<Item> items = new ArrayList<>();
        if (list != null) {
            for (Studio s : list) {
                if (s == null || s.id <= 0) continue;
                String url = s.thumbnail_url;
                if (url == null || url.isEmpty()) url = "/api/studio_thumb/" + s.id;
                if (!url.startsWith("http")) url = Api.abs(url);
                items.add(new Item(s.id, s.name, url, true));
            }
        }
        return new BrandAdapter(items, fill, click);
    }

    public static void openProvider(android.content.Context ctx, Item it) {
        if (ctx == null || it == null) return;
        CatalogActivity.open(ctx, "provider", it.id, it.name);
    }

    public static void openStudio(android.content.Context ctx, Item it) {
        if (ctx == null || it == null) return;
        CatalogActivity.open(ctx, "studio", it.id, it.name);
    }

    @NonNull
    @Override
    public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_brand_card, parent, false);
        RecyclerView.LayoutParams lp = (RecyclerView.LayoutParams) v.getLayoutParams();
        if (lp == null) {
            lp = new RecyclerView.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        }
        float d = parent.getResources().getDisplayMetrics().density;
        if (fillWidth) {
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            lp.setMargins(Math.round(6 * d), Math.round(6 * d), Math.round(6 * d), Math.round(6 * d));
        } else {
            lp.width = Math.round(128 * d);
            lp.setMargins(0, 0, Math.round(10 * d), 0);
        }
        v.setLayoutParams(lp);
        return new VH(v);
    }

    @Override
    public void onBindViewHolder(@NonNull VH h, int position) {
        Item it = data.get(position);
        h.name.setText(it.name);
        String letter = it.name.isEmpty() ? "?" : it.name.substring(0, 1).toUpperCase();
        h.letter.setText(letter);
        h.letter.setVisibility(View.VISIBLE);
        float d = h.itemView.getResources().getDisplayMetrics().density;
        ViewGroup.LayoutParams box = h.logoBox.getLayoutParams();
        if (it.studio) {
            box.width = Math.round(56 * d);
            box.height = Math.round(56 * d);
            h.logoBox.setBackgroundResource(R.drawable.brand_logo_circle);
            h.letter.setTextColor(0xFFE9D5FF);
        } else {
            box.width = Math.round(72 * d);
            box.height = Math.round(48 * d);
            h.logoBox.setBackgroundResource(R.drawable.brand_logo_white);
            h.letter.setTextColor(0xFF2A1848);
        }
        h.logoBox.setLayoutParams(box);
        Images.loadContain(h.logo, it.imageUrl,
                () -> h.letter.setVisibility(View.GONE),
                () -> h.letter.setVisibility(View.VISIBLE));
        h.itemView.setOnClickListener(v -> {
            if (click != null) click.on(it);
        });
        Motion.press(h.itemView);
    }

    @Override
    public int getItemCount() { return data.size(); }

    public Item get(int i) { return data.get(i); }

    static class VH extends RecyclerView.ViewHolder {
        final FrameLayout logoBox;
        final ImageView logo;
        final TextView letter;
        final TextView name;
        VH(View v) {
            super(v);
            logoBox = v.findViewById(R.id.logoBox);
            logo = v.findViewById(R.id.logo);
            letter = v.findViewById(R.id.letter);
            name = v.findViewById(R.id.name);
        }
    }
}
