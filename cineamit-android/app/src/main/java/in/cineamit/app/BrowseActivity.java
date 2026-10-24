package in.cineamit.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.fragment.app.FragmentActivity;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.util.List;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.MediaItem;
import in.cineamit.app.ui.LoadMoreFooter;
import in.cineamit.app.ui.PosterAdapter;
import in.cineamit.app.ui.Ui;

public class BrowseActivity extends FragmentActivity {
    private PosterAdapter adapter;
    private String kind;
    private String category = "popular";
    private String genre = "";
    private int page = 1;
    private int total = 1;
    private boolean loading;
    private int loadGen;
    private LinearLayout chipRow;
    private LoadMoreFooter moreFoot;

    public static void open(Context ctx, String kind, String title) {
        open(ctx, kind, title, "popular");
    }

    public static void open(Context ctx, String kind, String title, String category) {
        ctx.startActivity(new Intent(ctx, BrowseActivity.class)
                .putExtra("kind", kind)
                .putExtra("title", title)
                .putExtra("category", category == null ? "popular" : category));
    }

    public static void openGenre(Context ctx, String kind, String title, String genreId) {
        ctx.startActivity(new Intent(ctx, BrowseActivity.class)
                .putExtra("kind", kind)
                .putExtra("title", title)
                .putExtra("genre", genreId == null ? "" : genreId));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_browse);
        kind = getIntent().getStringExtra("kind");
        if (kind == null) kind = "movie";
        String title = getIntent().getStringExtra("title");
        if (title == null) title = "Movies";
        String catIn = getIntent().getStringExtra("category");
        if (catIn != null && !catIn.isEmpty()) category = catIn;
        String gIn = getIntent().getStringExtra("genre");
        if (gIn != null) genre = gIn;
        Ui.cineHeader(findViewById(android.R.id.content), title, v -> finish());
        in.cineamit.app.ui.Motion.rise(findViewById(R.id.browseTitle), 40);
        RecyclerView grid = findViewById(R.id.grid);
        int span = Ui.posterSpan(this);
        GridLayoutManager lm = new GridLayoutManager(this, span);
        grid.setLayoutManager(lm);
        adapter = new PosterAdapter(item -> DetailsActivity.open(this, item.media_type, item.id), true);
        moreFoot = new LoadMoreFooter(this::loadMore);
        LoadMoreFooter.attach(grid, adapter, moreFoot, span);
        Ui.padForIsland(grid);
        chipRow = findViewById(R.id.chipRow);
        paintChips();
        load(1, true);
    }

    private boolean standardCategory() {
        return "popular".equals(category) || "top_rated".equals(category)
                || "now_playing".equals(category) || "upcoming".equals(category)
                || "on_the_air".equals(category) || "airing_today".equals(category);
    }

    private void paintChips() {
        chipRow.removeAllViews();
        if (genre != null && !genre.isEmpty()) {
            findViewById(R.id.chipScroll).setVisibility(View.GONE);
            return;
        }
        findViewById(R.id.chipScroll).setVisibility(View.VISIBLE);
        addChip("Popular", "popular");
        addChip("Top rated", "top_rated");
        if ("anime".equals(kind)) {
            addChip("Latest", "now_playing");
        } else if ("tv".equals(kind)) {
            addChip("On air", "on_the_air");
            addChip("Airing today", "airing_today");
            addChip("Netflix", "netflix");
            addChip("Prime", "prime");
            addChip("Apple", "apple");
            addChip("Cartoons", "cartoons");
            addChip("Korean", "korean");
        } else {
            addChip("Now playing", "now_playing");
            addChip("Upcoming", "upcoming");
            addChip("Bollywood", "bollywood");
            addChip("Hollywood", "hollywood");
            addChip("Indian", "indian");
            addChip("South", "south");
            addChip("Korean", "korean");
        }
    }

    private void addChip(String label, String value) {
        boolean on = value.equals(category);
        TextView chip = Ui.chip(this, label, on, v -> {
            if (value.equals(category)) return;
            category = value;
            paintChips();
            load(1, true);
        });
        chipRow.addView(chip);
    }

    private void load(int p, boolean reset) {
        if (loading && !reset) return;
        final int my = ++loadGen;
        loading = true;
        findViewById(R.id.progress).setVisibility(reset ? View.VISIBLE : View.GONE);
        findViewById(R.id.status).setVisibility(View.GONE);
        if (reset) {
            if (moreFoot != null) moreFoot.hide();
            if (adapter != null && p == 1) adapter.setItems(null);
        } else if (moreFoot != null) moreFoot.loading();
        final String cat = category;
        final String g = genre;
        Io.run(this, () -> (g != null && !g.isEmpty()) ? Api.filter(kind, g, p) : Api.catalog(kind, p, cat), json -> {
            if (my != loadGen) return;
            loading = false;
            findViewById(R.id.progress).setVisibility(View.GONE);
            if (!cat.equals(category)) return;
            Api.applyMeta(json);
            List<MediaItem> items = Api.parseItems(json.optJSONArray("items"));
            page = p;
            int reported = json.optInt("total_pages", 0);
            if (reported > 0) total = reported;
            else total = items.size() >= 15 ? p + 1 : p;
            int added = items.size();
            if (reset) adapter.setItems(items);
            else added = adapter.addItems(items);
            if (!reset && (items.isEmpty() || added == 0)) total = page;
            if (page >= total) moreFoot.hide();
            else moreFoot.idle(adapter.getItemCount() > 0);
            if (adapter.getItemCount() == 0) {
                moreFoot.hide();
                TextView s = findViewById(R.id.status);
                s.setText("No titles.");
                s.setVisibility(View.VISIBLE);
            }
        }, e -> {
            if (my != loadGen) return;
            loading = false;
            findViewById(R.id.progress).setVisibility(View.GONE);
            TextView s = findViewById(R.id.status);
            s.setText(CineAmitApp.friendlyNetError(e));
            s.setVisibility(adapter.getItemCount() == 0 ? View.VISIBLE : View.GONE);
            if (page < total && adapter.getItemCount() > 0) moreFoot.idle(true);
            else moreFoot.hide();
        });
    }

    private void loadMore() {
        if (loading || page >= total) {
            if (moreFoot != null && page >= total) moreFoot.hide();
            return;
        }
        load(page + 1, false);
    }
}
