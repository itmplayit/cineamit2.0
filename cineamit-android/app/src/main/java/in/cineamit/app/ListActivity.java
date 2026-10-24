package in.cineamit.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.fragment.app.FragmentActivity;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.util.List;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.Provider;
import in.cineamit.app.data.Models.Studio;
import in.cineamit.app.ui.BrandAdapter;
import in.cineamit.app.ui.Ui;

public class ListActivity extends FragmentActivity {
    public static void open(Context ctx, String kind) {
        ctx.startActivity(new Intent(ctx, ListActivity.class).putExtra("kind", kind));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_list);
        String kind = getIntent().getStringExtra("kind");
        boolean studios = !"providers".equals(kind);
        Ui.cineHeader(findViewById(android.R.id.content),
                studios ? "Top Production Studios" : "Streaming Providers", v -> finish());
        RecyclerView list = findViewById(R.id.list);
        list.setLayoutManager(Ui.posterGrid(this));
        Ui.padForIsland(list);
        findViewById(R.id.progress).setVisibility(View.VISIBLE);
        if (studios) {
            Io.run(this, Api::studios, json -> {
                findViewById(R.id.progress).setVisibility(View.GONE);
                Api.applyMeta(json);
                List<Studio> items = Api.parseStudios(json.optJSONArray("studios"));
                list.setAdapter(BrandAdapter.studios(items, true, it -> BrandAdapter.openStudio(this, it)));
                if (items.isEmpty()) status("No studios.");
            }, this::fail);
        } else {
            Io.run(this, Api::providers, json -> {
                findViewById(R.id.progress).setVisibility(View.GONE);
                Api.applyMeta(json);
                List<Provider> items = Api.parseProviders(json.optJSONArray("providers"));
                list.setAdapter(BrandAdapter.providers(items, true, it -> BrandAdapter.openProvider(this, it)));
                if (items.isEmpty()) status("No providers.");
            }, this::fail);
        }
    }

    private void status(String m) {
        TextView t = findViewById(R.id.status);
        t.setText(m);
        t.setVisibility(View.VISIBLE);
    }

    private void fail(Exception e) {
        findViewById(R.id.progress).setVisibility(View.GONE);
        status(CineAmitApp.friendlyNetError(e));
    }

    public static class TextAdapter extends RecyclerView.Adapter<TextAdapter.VH> {
        public interface Click { void on(int i); }
        final List<String> data;
        final Click click;
        public TextAdapter(List<String> data, Click click) {
            this.data = data;
            this.click = click;
        }
        @NonNull
        @Override
        public VH onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            View v = android.view.LayoutInflater.from(parent.getContext()).inflate(R.layout.item_text_row, parent, false);
            return new VH(v);
        }
        @Override
        public void onBindViewHolder(@NonNull VH h, int position) {
            ((TextView) h.itemView).setText(data.get(position));
            h.itemView.setOnClickListener(v -> {
                if (click != null) click.on(position);
            });
        }
        @Override public int getItemCount() { return data.size(); }
        static class VH extends RecyclerView.ViewHolder {
            VH(View v) { super(v); }
        }
    }
}
