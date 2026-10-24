package in.cineamit.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.fragment.app.FragmentActivity;

import java.util.List;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.VodEpisode;
import in.cineamit.app.data.Models.VodSeason;
import in.cineamit.app.ui.Ui;

public class VodSeriesActivity extends FragmentActivity {
    private List<VodSeason> seasons;
    private int seasonNo = 1;

    public static void open(Context ctx, String id) {
        ctx.startActivity(new Intent(ctx, VodSeriesActivity.class).putExtra("id", id));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_details);
        findViewById(R.id.btnBack).setOnClickListener(v -> finish());
        String id = getIntent().getStringExtra("id");
        findViewById(R.id.progress).setVisibility(View.VISIBLE);
        Io.run(this, () -> Api.iptvSeries(id), json -> {
            findViewById(R.id.progress).setVisibility(View.GONE);
            if (!json.optBoolean("ok", true)) {
                TextView s = findViewById(R.id.status);
                s.setText(json.optString("error", "Not found"));
                s.setVisibility(View.VISIBLE);
                return;
            }
            findViewById(R.id.scroll).setVisibility(View.VISIBLE);
            String title = json.optString("name");
            ((TextView) findViewById(R.id.title)).setText(title);
            String logo = json.optString("logo");
            if (logo != null && !logo.isEmpty() && !logo.startsWith("http")) logo = Api.abs(logo);
            Images.load(findViewById(R.id.backdrop), logo);
            String meta = json.optString("year");
            if (!json.optString("category").isEmpty()) meta = meta + "  •  " + json.optString("category");
            ((TextView) findViewById(R.id.meta)).setText(meta);
            findViewById(R.id.btnWatch).setVisibility(View.GONE);
            findViewById(R.id.btnWatchlist).setVisibility(View.GONE);
            seasons = Api.parseVodSeasons(json.optJSONArray("seasons"));
            if (seasons != null && !seasons.isEmpty()) seasonNo = seasons.get(0).season_number;
            bindSeasons();
        }, e -> {
            findViewById(R.id.progress).setVisibility(View.GONE);
            TextView s = findViewById(R.id.status);
            s.setText(e.getMessage());
            s.setVisibility(View.VISIBLE);
        });
    }

    private void bindSeasons() {
        if (seasons == null || seasons.isEmpty()) return;
        findViewById(R.id.seasonsLabel).setVisibility(View.VISIBLE);
        findViewById(R.id.seasonsScroll).setVisibility(View.VISIBLE);
        LinearLayout row = findViewById(R.id.seasonsRow);
        row.removeAllViews();
        for (VodSeason s : seasons) {
            String label = s.name == null || s.name.isEmpty() ? "S" + s.season_number : s.name;
            row.addView(Ui.chip(this, label, s.season_number == seasonNo, v -> {
                seasonNo = s.season_number;
                bindSeasons();
            }));
        }
        LinearLayout box = findViewById(R.id.episodesBox);
        box.removeAllViews();
        VodSeason cur = null;
        for (VodSeason s : seasons) if (s.season_number == seasonNo) cur = s;
        if (cur == null) return;
        LayoutInflater inf = LayoutInflater.from(this);
        for (VodEpisode ep : cur.episodes) {
            View r = inf.inflate(R.layout.item_episode, box, false);
            ((TextView) r.findViewById(R.id.name)).setText(ep.episode_number + ". " + ep.name);
            Images.load(r.findViewById(R.id.still), ep.still);
            r.setOnClickListener(v -> {
                if (ep.play != null && !ep.play.isEmpty()) PlayerActivity.openNative(this, ep.play, ep.name);
            });
            box.addView(r);
        }
    }
}
