package in.cineamit.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
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

public class CatalogActivity extends FragmentActivity {
    private PosterAdapter adapter;
    private String kind;
    private long catalogId;
    private int page = 1;
    private int total = 1;
    private boolean loading;
    private int loadGen;
    private LoadMoreFooter moreFoot;

    public static void open(Context ctx, String kind, long id, String name) {
        ctx.startActivity(new Intent(ctx, CatalogActivity.class)
                .putExtra("kind", kind).putExtra("id", id).putExtra("name", name));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_browse);
        kind = getIntent().getStringExtra("kind");
        catalogId = getIntent().getLongExtra("id", 0);
        String name = getIntent().getStringExtra("name");
        if (name == null) name = "Catalog";
        Ui.cineHeader(findViewById(android.R.id.content), name, v -> finish());
        findViewById(R.id.chipScroll).setVisibility(View.GONE);
        RecyclerView grid = findViewById(R.id.grid);
        int span = Ui.posterSpan(this);
        GridLayoutManager lm = new GridLayoutManager(this, span);
        grid.setLayoutManager(lm);
        adapter = new PosterAdapter(item -> DetailsActivity.open(this, item.media_type, item.id), true);
        moreFoot = new LoadMoreFooter(this::loadMore);
        LoadMoreFooter.attach(grid, adapter, moreFoot, span);
        Ui.padForIsland(grid);
        load(1, true);
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
        Io.run(this, () -> {
            if ("credits".equals(kind)) return Api.personCredits(catalogId, p);
            if ("studio".equals(kind)) return Api.studio(catalogId, p);
            return Api.provider(catalogId, p);
        }, json -> {
            if (my != loadGen) return;
            loading = false;
            findViewById(R.id.progress).setVisibility(View.GONE);
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
            if (page >= total || adapter.getItemCount() == 0) moreFoot.hide();
            else moreFoot.idle(true);
            if (adapter.getItemCount() == 0) {
                TextView s = findViewById(R.id.status);
                s.setText("Nothing in this catalog.");
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
