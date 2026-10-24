package in.cineamit.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;

import androidx.fragment.app.FragmentActivity;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import in.cineamit.app.data.Api;
import in.cineamit.app.ui.PosterAdapter;
import in.cineamit.app.ui.Ui;

public class SearchActivity extends FragmentActivity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pending;
    private PosterAdapter adapter;
    private int gen;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_search);
        Ui.cineHeader(findViewById(android.R.id.content), "Search", v -> finish());
        in.cineamit.app.ui.Motion.fadeUp(findViewById(R.id.query), 80);
        RecyclerView grid = findViewById(R.id.grid);
        grid.setLayoutManager(Ui.posterGrid(this));
        Ui.padForIsland(grid);
        adapter = new PosterAdapter(item -> DetailsActivity.open(this, item.media_type, item.id), true);
        grid.setAdapter(adapter);
        EditText q = findViewById(R.id.query);
        String prefill = getIntent() != null ? getIntent().getStringExtra("search") : null;
        if (prefill != null && !prefill.isEmpty()) {
            q.setText(prefill);
            q.setSelection(prefill.length());
            search(prefill.trim());
        }
        q.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
            @Override public void onTextChanged(CharSequence s, int st, int b, int c) {}
            @Override public void afterTextChanged(Editable s) {
                if (pending != null) handler.removeCallbacks(pending);
                pending = () -> search(s.toString().trim());
                handler.postDelayed(pending, 140);
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (pending != null) handler.removeCallbacks(pending);
        super.onDestroy();
    }

    private void search(String query) {
        TextView status = findViewById(R.id.status);
        if (query.length() < 2) {
            gen++;
            adapter.setItems(null);
            findViewById(R.id.progress).setVisibility(View.GONE);
            status.setVisibility(query.isEmpty() ? View.GONE : View.VISIBLE);
            if (!query.isEmpty()) status.setText("Two more letters…");
            return;
        }
        final int token = ++gen;
        findViewById(R.id.progress).setVisibility(View.VISIBLE);
        status.setVisibility(View.GONE);
        Io.run(this, () -> Api.search(query), json -> {
            if (token != gen) return;
            findViewById(R.id.progress).setVisibility(View.GONE);
            Api.applyMeta(json);
            Analytics.search(query);
            adapter.setItems(Api.parseItems(json.optJSONArray("items") != null ? json.optJSONArray("items") : json.optJSONArray("results")));
            if (adapter.getItemCount() == 0) {
                status.setText("No matches for \"" + query + "\"");
                status.setVisibility(View.VISIBLE);
            }
        }, e -> {
            if (token != gen) return;
            findViewById(R.id.progress).setVisibility(View.GONE);
            status.setText(e.getMessage());
            status.setVisibility(View.VISIBLE);
        });
    }
}
