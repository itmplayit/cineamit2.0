package in.cineamit.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.fragment.app.FragmentActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.DlVault;
import in.cineamit.app.data.Downloads;
import in.cineamit.app.data.GallerySave;
import in.cineamit.app.data.Models.CastPerson;
import in.cineamit.app.data.Models.Episode;
import in.cineamit.app.data.Models.MediaItem;
import in.cineamit.app.data.Models.Season;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.ui.Motion;
import in.cineamit.app.ui.PosterAdapter;
import in.cineamit.app.ui.Ui;

public class DetailsActivity extends FragmentActivity {
    private String type;
    private long id;
    private MediaItem item;
    private List<Season> seasons;
    private int seasonNo = 1;
    private boolean inWatchlist;
    private boolean watchlistBusy;
    private int reviewRating = 5;
    private PosterAdapter similarAdapter;
    private int similarPage = 1;
    private int similarTotal = 1;
    private boolean similarLoading;
    private boolean sheetGallery;
    private Runnable afterWrite;

    public static void open(Context ctx, String type, long id) {
        ctx.startActivity(new Intent(ctx, DetailsActivity.class).putExtra("type", type).putExtra("id", id));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_details);
        Ui.padForIsland(findViewById(R.id.scroll));
        type = getIntent().getStringExtra("type");
        if (type == null) type = "movie";
        id = getIntent().getLongExtra("id", 0);
        Analytics.select(type, id);
        ImageView back = findViewById(R.id.btnBack);
        Ui.tint(back, Color.WHITE);
        back.setOnClickListener(v -> finish());
        Ui.padTopInset(findViewById(R.id.cineHeaderTop));
        load();
    }

    private void load() {
        findViewById(R.id.progress).setVisibility(View.VISIBLE);
        Io.run(this, () -> Api.details(type, id), json -> {
            findViewById(R.id.progress).setVisibility(View.GONE);
            if (!json.optBoolean("ok", true)) {
                TextView s = findViewById(R.id.status);
                s.setText(json.optString("error", "Not found"));
                s.setVisibility(View.VISIBLE);
                return;
            }
            Api.applyMeta(json);
            JSONObject o = json.optJSONObject("item");
            if (o == null) {
                findViewById(R.id.status).setVisibility(View.VISIBLE);
                ((TextView) findViewById(R.id.status)).setText("Not found");
                return;
            }
            item = Api.parseItem(o);
            inWatchlist = json.optBoolean("in_watchlist", false);
            seasons = Api.parseSeasons(json.optJSONArray("seasons"));
            bind(json);
        }, e -> {
            findViewById(R.id.progress).setVisibility(View.GONE);
            TextView s = findViewById(R.id.status);
            s.setText(e.getMessage());
            s.setVisibility(View.VISIBLE);
        });
    }

    private void bind(JSONObject json) {
        findViewById(R.id.scroll).setVisibility(View.VISIBLE);
        Images.load(findViewById(R.id.backdrop), Api.img(Session.imageBase,
                item.backdrop_path != null && !item.backdrop_path.isEmpty() ? item.backdrop_path : item.poster_path, "original"));
        Motion.kenBurns(findViewById(R.id.backdrop));
        Motion.shine(findViewById(R.id.editorialSlash));
        Motion.rise(findViewById(R.id.title), 80);
        TextView title = findViewById(R.id.title);
        title.setText(item.title);
        ImageView titleImg = findViewById(R.id.titleImg);
        String logoUrl = Images.logoUrl(item.logo_path);
        if (logoUrl == null || logoUrl.isEmpty()) {
            titleImg.setVisibility(View.GONE);
            title.setVisibility(View.VISIBLE);
        } else {
            titleImg.setVisibility(View.INVISIBLE);
            Images.loadLogo(titleImg, logoUrl, () -> {
                titleImg.setVisibility(View.VISIBLE);
                title.setVisibility(View.GONE);
            }, () -> {
                titleImg.setVisibility(View.GONE);
                title.setVisibility(View.VISIBLE);
            });
        }
        TextView year = findViewById(R.id.editorialYear);
        year.setText(item.year == null || item.year.isEmpty() ? "—" : item.year);
        TextView rt = findViewById(R.id.editorialRuntime);
        if (item.runtime > 0) rt.setText((item.runtime / 60) + "h " + (item.runtime % 60) + "m");
        else rt.setText("tv".equals(item.media_type) ? "Series" : "Movie");
        TextView score = findViewById(R.id.editorialScore);
        score.setText(item.vote_average > 0 ? String.format(java.util.Locale.US, "%.1f", item.vote_average) : "—");
        ((TextView) findViewById(R.id.genres)).setText(item.genres.isEmpty() ? "" : String.join("  ·  ", item.genres));
        ((TextView) findViewById(R.id.tagline)).setText(item.tagline);
        ((TextView) findViewById(R.id.overview)).setText(item.overview);
        boolean person = "person".equals(item.media_type);
        findViewById(R.id.btnWatch).setVisibility(person ? View.GONE : View.VISIBLE);
        findViewById(R.id.btnWatchlist).setVisibility(person ? View.GONE : View.VISIBLE);
        if (person) Motion.stop(findViewById(R.id.btnWatch));
        else Motion.pulse(findViewById(R.id.btnWatch));
        ((TextView) findViewById(R.id.btnWatch)).setText("tv".equals(item.media_type) ? "Watch Episode" : "Watch Now");
        paintWatchlist();
        findViewById(R.id.btnWatch).setOnClickListener(v -> {
            int ep = 1;
            if ("tv".equals(item.media_type)) {
                String saved = getSharedPreferences("cineamit", 0).getString("last_ep_" + type + "_" + id, null);
                if (saved != null) {
                    try {
                        String[] parts = saved.split("\\|");
                        int savedS = Integer.parseInt(parts[0]);
                        int savedE = parts.length > 1 ? Integer.parseInt(parts[1]) : 1;
                        if (savedS == seasonNo) ep = Math.max(1, savedE);
                    } catch (Exception ignored) {}
                }
            }
            final int playEp = ep;
            Ads.showInterstitial(this, () -> play(seasonNo, playEp));
        });
        findViewById(R.id.btnWatchlist).setOnClickListener(v -> toggleWatchlist());
        View trailer = findViewById(R.id.btnTrailer);
        if (trailer != null) {
            trailer.setVisibility(person ? View.GONE : View.VISIBLE);
            trailer.setOnClickListener(v -> openTrailer());
            Motion.press(trailer);
        }
        View share = findViewById(R.id.btnShare);
        if (share != null) {
            share.setOnClickListener(v -> shareTitle());
            Motion.press(share);
        }
        View dl = findViewById(R.id.btnDownload);
        if (dl != null) {
            dl.setVisibility(person ? View.GONE : View.VISIBLE);
            dl.setOnClickListener(v -> {
                sheetGallery = false;
                showDownloadSheet();
            });
            Motion.press(dl);
        }
        View gal = findViewById(R.id.btnGallery);
        if (gal != null) {
            gal.setVisibility(person ? View.GONE : View.VISIBLE);
            gal.setOnClickListener(v -> galleryPick());
            Motion.press(gal);
        }
        View reward = findViewById(R.id.btnReward);
        if (reward != null) {
            boolean hideAd = person || !Ads.rewardOn();
            reward.setVisibility(hideAd ? View.GONE : View.VISIBLE);
            if (reward instanceof TextView) {
                ((TextView) reward).setText("Earn +" + Sub.adPoints() + " pts");
            }
            reward.setOnClickListener(v -> {
                if (Session.user == null) {
                    Toast.makeText(this, "Sign in to earn points.", Toast.LENGTH_SHORT).show();
                    LoginActivity.open(this);
                    return;
                }
                Ads.showRewarded(this, earned -> {
                    if (!Io.alive(this)) return;
                    if (earned == null || !earned.optBoolean("ok")) {
                        Toast.makeText(this, "Points were not added.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    Sub.applyRemote(earned);
                    int add = earned.optInt("added", Sub.adPoints());
                    Toast.makeText(this, "+" + add + " pts  ·  total " + Sub.points(), Toast.LENGTH_SHORT).show();
                });
            });
            Motion.press(reward);
        }
        View overlay = findViewById(R.id.dlOverlay);
        if (overlay != null) {
            overlay.setOnClickListener(v -> {
                sheetGallery = false;
                overlay.setVisibility(View.GONE);
            });
            View card = findViewById(R.id.dlCard);
            if (card != null) card.setOnClickListener(v -> {});
            findViewById(R.id.dlCancel).setOnClickListener(v -> {
                sheetGallery = false;
                overlay.setVisibility(View.GONE);
            });
        }
        View reviewBtn = findViewById(R.id.btnReview);
        if (reviewBtn != null) {
            findViewById(R.id.reviewBox).setVisibility(person ? View.GONE : View.VISIBLE);
            reviewBtn.setOnClickListener(v -> postReview());
            Motion.press(reviewBtn);
            paintRating();
        }
        bindSeasons();
        bindCast(Api.parseCast(json.optJSONArray("cast")));
        similarPage = 1;
        similarTotal = Math.max(1, json.optInt("credit_pages", 1));
        bindSimilar(Api.parseItems(json.optJSONArray("similar")));
        if ("tv".equals(type) && seasonNo > 0) loadEpisodes();
    }

    private void paintWatchlist() {
        ImageView iv = findViewById(R.id.btnWatchlist);
        iv.setImageResource(inWatchlist ? R.drawable.ic_watch_list_remove : R.drawable.ic_watch_list_add);
        Ui.tint(iv, Color.WHITE);
    }

    private void toggleWatchlist() {
        if (watchlistBusy || item == null) return;
        watchlistBusy = true;
        Io.run(this, () -> Api.watchlistToggle(item.media_type, item.id), json -> {
            watchlistBusy = false;
            if ("login_required".equals(json.optString("error"))) {
                err("Sign in to use the watchlist.");
                LoginActivity.open(this);
                return;
            }
            if (json.optBoolean("ok")) {
                inWatchlist = json.optBoolean("in_watchlist");
                paintWatchlist();
            }
        }, e -> watchlistBusy = false);
    }

    private void bindSeasons() {
        if (seasons == null || seasons.isEmpty()) return;
        findViewById(R.id.seasonsLabel).setVisibility(View.VISIBLE);
        findViewById(R.id.seasonsScroll).setVisibility(View.VISIBLE);
        LinearLayout row = findViewById(R.id.seasonsRow);
        row.removeAllViews();
        String saved = getSharedPreferences("cineamit", 0).getString("last_ep_" + type + "_" + id, null);
        if (saved != null) {
            try {
                int sn = Integer.parseInt(saved.split("\\|")[0]);
                for (Season s : seasons) if (s.season_number == sn) seasonNo = sn;
            } catch (Exception ignored) {}
        } else seasonNo = seasons.get(0).season_number;
        for (Season s : seasons) {
            boolean sel = s.season_number == seasonNo;
            String label = s.name == null || s.name.isEmpty() ? "S" + s.season_number : s.name;
            row.addView(Ui.chip(this, label, sel, v -> {
                seasonNo = s.season_number;
                bindSeasons();
                loadEpisodes();
            }));
        }
    }

    private void loadEpisodes() {
        Io.run(this, () -> Api.episodes(id, seasonNo), json -> {
            List<Episode> eps = Api.parseEpisodes(json.optJSONArray("episodes"));
            LinearLayout box = findViewById(R.id.episodesBox);
            box.removeAllViews();
            if (eps.isEmpty()) return;
            TextView h = new TextView(this);
            h.setText("Episodes");
            h.setTextColor(Color.WHITE);
            h.setTextSize(18);
            h.setPadding(dp(16), dp(16), dp(16), dp(8));
            box.addView(h);
            LayoutInflater inf = LayoutInflater.from(this);
            for (Episode ep : eps) {
                View row = inf.inflate(R.layout.item_episode, box, false);
                ((TextView) row.findViewById(R.id.name)).setText(ep.episode_number + ". " + ep.name);
                ((TextView) row.findViewById(R.id.overview)).setText(ep.overview);
                Images.load(row.findViewById(R.id.still), Api.img(Session.imageBase, ep.still_path, "w300"));
                int n = Math.max(1, ep.episode_number);
                row.setOnClickListener(v -> play(seasonNo, n));
                box.addView(row);
            }
        }, e -> {});
    }

    private void bindCast(List<CastPerson> cast) {
        if (cast == null || cast.isEmpty()) return;
        findViewById(R.id.castLabel).setVisibility(View.VISIBLE);
        findViewById(R.id.castScroll).setVisibility(View.VISIBLE);
        LinearLayout row = findViewById(R.id.castRow);
        row.removeAllViews();
        LayoutInflater inf = LayoutInflater.from(this);
        for (CastPerson c : cast) {
            View col = inf.inflate(R.layout.row_actor_director_item, row, false);
            Images.load(col.findViewById(R.id.imageActor), Api.img(Session.imageBase, c.profile_path, "w185"));
            ((TextView) col.findViewById(R.id.text)).setText(c.name);
            col.setOnClickListener(v -> open(this, "person", c.id));
            row.addView(col);
        }
    }

    private void bindSimilar(List<MediaItem> similar) {
        LinearLayout box = findViewById(R.id.similarBox);
        box.removeAllViews();
        if (similar == null || similar.isEmpty()) return;
        View rail = LayoutInflater.from(this).inflate(R.layout.item_rail, box, false);
        ((TextView) rail.findViewById(R.id.railTitle)).setText("person".equals(type) ? "Filmography" : "More like this");
        androidx.recyclerview.widget.RecyclerView rv = rail.findViewById(R.id.railList);
        rv.setLayoutManager(new androidx.recyclerview.widget.LinearLayoutManager(this, androidx.recyclerview.widget.RecyclerView.HORIZONTAL, false));
        similarAdapter = new PosterAdapter(it -> open(this, it.media_type, it.id), false);
        rv.setAdapter(similarAdapter);
        similarAdapter.setItems(similar);
        box.addView(rail);
        TextView all = rail.findViewById(R.id.viewAll);
        boolean person = "person".equals(type);
        if (all != null) {
            all.setVisibility(person ? View.VISIBLE : View.GONE);
            if (person) {
                String name = item != null && item.title != null ? item.title : "Filmography";
                all.setOnClickListener(v -> CatalogActivity.open(this, "credits", id, name));
                Motion.press(all);
            }
        }
        if (person && similarPage < similarTotal) {
            View more = LayoutInflater.from(this).inflate(R.layout.view_load_more, box, false);
            more.setTag("credits_more");
            paintCreditsMore(more, false);
            more.setOnClickListener(v -> loadMoreCredits(more));
            box.addView(more);
            rv.addOnScrollListener(new androidx.recyclerview.widget.RecyclerView.OnScrollListener() {
                @Override
                public void onScrolled(androidx.recyclerview.widget.RecyclerView recycler, int dx, int dy) {
                    androidx.recyclerview.widget.RecyclerView.LayoutManager lm = recycler.getLayoutManager();
                    if (!(lm instanceof androidx.recyclerview.widget.LinearLayoutManager)) return;
                    int last = ((androidx.recyclerview.widget.LinearLayoutManager) lm).findLastVisibleItemPosition();
                    int n = lm.getItemCount();
                    if (n > 0 && last >= n - 2) loadMoreCredits(more);
                }
            });
        }
    }

    private void paintCreditsMore(View more, boolean loading) {
        if (more == null) return;
        View spin = more.findViewById(R.id.loadMoreSpin);
        TextView t = more.findViewById(R.id.loadMoreText);
        if (spin != null) spin.setVisibility(loading ? View.VISIBLE : View.GONE);
        if (t != null) t.setText(loading ? "Loading…" : "Load more");
        more.setEnabled(!loading);
        more.setAlpha(loading ? 0.82f : 1f);
    }

    private void loadMoreCredits(View more) {
        if (similarLoading || similarAdapter == null || similarPage >= similarTotal) {
            if (more != null) more.setVisibility(View.GONE);
            return;
        }
        similarLoading = true;
        paintCreditsMore(more, true);
        final int next = similarPage + 1;
        Io.run(this, () -> Api.personCredits(id, next), json -> {
            similarLoading = false;
            List<MediaItem> extra = Api.parseItems(json.optJSONArray("items"));
            int reported = json.optInt("total_pages", similarTotal);
            if (reported > 0) similarTotal = reported;
            similarPage = next;
            int added = similarAdapter.addItems(extra);
            if (similarPage >= similarTotal || extra.isEmpty() || added == 0) more.setVisibility(View.GONE);
            else paintCreditsMore(more, false);
        }, e -> {
            similarLoading = false;
            paintCreditsMore(more, false);
        });
    }

    private void paintRating() {
        LinearLayout row = findViewById(R.id.ratingRow);
        if (row == null) return;
        row.removeAllViews();
        for (int i = 1; i <= 5; i++) {
            final int n = i;
            TextView chip = Ui.chip(this, String.valueOf(i), reviewRating == n, v -> {
                reviewRating = n;
                paintRating();
            });
            row.addView(chip);
        }
    }

    private void openTrailer() {
        if (item == null) return;
        Io.run(this, () -> Api.trailer(type, id), json -> {
            String key = json.optString("key");
            if (key == null || key.isEmpty() || "null".equalsIgnoreCase(key)) {
                err("Trailer not found.");
                return;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=" + key)));
            } catch (Exception e) {
                err("YouTube could not open.");
            }
        }, e -> err(e.getMessage()));
    }

    private int[] downloadEp() {
        int s = 1, e = 1;
        if ("tv".equals(type) || "anime".equals(type)) {
            s = Math.max(1, seasonNo);
            String saved = getSharedPreferences("cineamit", 0).getString("last_ep_" + type + "_" + id, null);
            if (saved != null && saved.contains("|")) {
                try {
                    String[] p = saved.split("\\|");
                    s = Integer.parseInt(p[0]);
                    e = Integer.parseInt(p[1]);
                } catch (Exception ignored) {}
            }
        }
        return new int[]{s, e};
    }

    private void showDownloadSheet() {
        if (item == null) return;
        if (Session.user == null) {
            Toast.makeText(this, "Sign in to download", Toast.LENGTH_SHORT).show();
            LoginActivity.open(this);
            return;
        }
        View overlay = findViewById(R.id.dlOverlay);
        if (overlay != null) overlay.setVisibility(View.VISIBLE);
        CheckBox privBox = findViewById(R.id.dlPrivate);
        if (privBox != null) {
            privBox.setChecked(false);
            privBox.setVisibility(sheetGallery ? View.GONE : View.VISIBLE);
        }
        TextView ep = findViewById(R.id.dlEpisode);
        int[] se = downloadEp();
        if (ep != null) {
            if ("tv".equals(type) || "anime".equals(type)) {
                ep.setVisibility(View.VISIBLE);
                ep.setText("This episode  S" + se[0] + " E" + se[1] + "  ·  not a season pack");
            } else {
                ep.setVisibility(View.GONE);
            }
        }
        TextView loading = findViewById(R.id.dlLoading);
        LinearLayout list = findViewById(R.id.dlServerList);
        if (loading != null) {
            loading.setVisibility(View.VISIBLE);
            loading.setText("Loading URL…");
        }
        if (list != null) list.removeAllViews();
        final int s = se[0], e = se[1];
        Io.run(this, () -> Api.downloadOptions(type, id, s, e), json -> {
            JSONArray arr = json == null ? null : json.optJSONArray("downloads");
            if (arr == null || arr.length() == 0) {
                if (loading != null) {
                    loading.setVisibility(View.VISIBLE);
                    loading.setText("No download links found.");
                }
                return;
            }
            if (loading != null) loading.setVisibility(View.GONE);
            if (arr.length() == 1) {
                startDownload(arr.optJSONObject(0));
                return;
            }
            if (list == null) return;
            list.removeAllViews();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String name = o.optString("name", "Download");
                TextView row = new TextView(this);
                row.setText(name);
                row.setTextColor(i == 0 ? 0xFFC4B5FD : 0xFFF4F1EA);
                row.setTextSize(15);
                row.setPadding(dp(14), dp(14), dp(14), dp(14));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                lp.topMargin = i == 0 ? 0 : dp(8);
                row.setLayoutParams(lp);
                row.setBackgroundResource(i == 0 ? R.drawable.chip_on : R.drawable.chip_bg);
                final JSONObject pick = o;
                row.setOnClickListener(v -> startDownload(pick));
                Motion.press(row);
                list.addView(row);
            }
        }, err -> {
            if (loading != null) loading.setText(CineAmitApp.friendlyNetError(err));
        });
    }

    private void startDownload(JSONObject server) {
        View overlay = findViewById(R.id.dlOverlay);
        if (overlay != null) overlay.setVisibility(View.GONE);
        if (item == null) return;
        int[] se = downloadEp();
        Downloads.Item seed = new Downloads.Item();
        seed.type = type;
        seed.id = id;
        seed.s = se[0];
        seed.e = se[1];
        seed.title = item.title == null ? "Title" : item.title;
        if ("tv".equals(type) || "anime".equals(type)) {
            seed.title = seed.title + "  S" + se[0] + "E" + se[1];
        }
        seed.poster = item.poster_path;
        seed.quality = Downloads.Q_HIGH;
        CheckBox privBox = findViewById(R.id.dlPrivate);
        seed.toGallery = sheetGallery;
        seed.priv = !sheetGallery && privBox != null && privBox.isChecked();
        if (seed.priv) seed.toGallery = false;
        if (server != null) {
            seed.token = server.optString("token");
            seed.sourceUrl = Downloads.cleanDlUrl(server);
            seed.serverName = server.optString("name");
        }
        Runnable go = () -> {
            DownloadService.askNotify(this);
            Downloads.enqueue(seed, seed.token);
            String msg = seed.toGallery ? "Will save to Gallery after download"
                    : (seed.priv ? "Private download start" : "Download page khul raha hai");
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
        };
        if (seed.priv) {
            DlVault.ensure(this, () -> {
                go.run();
                DlVault.lock();
            });
            return;
        }
        go.run();
    }

    private void galleryPick() {
        if (item == null) return;
        new android.app.AlertDialog.Builder(this)
                .setTitle("Save to Gallery")
                .setItems(new CharSequence[]{"Poster", "Video (after download)"}, (d, which) -> {
                    if (which == 0) savePosterGallery();
                    else withWrite(() -> {
                        sheetGallery = true;
                        showDownloadSheet();
                    });
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void savePosterGallery() {
        if (item == null) return;
        String path = item.poster_path;
        if (path == null || path.isEmpty()) path = item.backdrop_path;
        String url = Api.img(Session.imageBase, path, "original");
        if (url == null || url.isEmpty()) {
            Toast.makeText(this, "Poster not found", Toast.LENGTH_SHORT).show();
            return;
        }
        final String posterUrl = url;
        final String name = item.title == null ? "CineAmit" : item.title;
        withWrite(() -> {
            Toast.makeText(this, "Saving to Gallery…", Toast.LENGTH_SHORT).show();
            Io.run(this, () -> GallerySave.putImageUrl(name, posterUrl), uri -> {
                if (uri == null || uri.isEmpty()) {
                    Toast.makeText(this, "Gallery save fail", Toast.LENGTH_SHORT).show();
                } else {
                    Toast.makeText(this, "Poster saved to Gallery", Toast.LENGTH_SHORT).show();
                }
            }, e -> Toast.makeText(this, "Gallery save fail", Toast.LENGTH_SHORT).show());
        });
    }

    private void withWrite(Runnable r) {
        if (!GallerySave.needWrite()) {
            r.run();
            return;
        }
        afterWrite = r;
        GallerySave.ask(this);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != GallerySave.REQ) return;
        boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        Runnable r = afterWrite;
        afterWrite = null;
        if (ok && r != null) r.run();
        else if (!ok) Toast.makeText(this, "Storage permission is required for Gallery", Toast.LENGTH_SHORT).show();
    }

    private void shareTitle() {
        if (item == null) return;
        String name = item.title == null ? "CineAmit" : item.title;
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("text/plain");
        i.putExtra(Intent.EXTRA_SUBJECT, name);
        i.putExtra(Intent.EXTRA_TEXT, "Watch " + name + " on CineAmit");
        startActivity(Intent.createChooser(i, "Share"));
    }

    private void postReview() {
        if (item == null) return;
        if (Session.user == null) {
            err("Sign in to post a review.");
            LoginActivity.open(this);
            return;
        }
        EditText box = findViewById(R.id.reviewText);
        String text = box == null || box.getText() == null ? "" : box.getText().toString().trim();
        Io.run(this, () -> Api.addReview(type, id, reviewRating, text), json -> {
            if ("login_required".equals(json.optString("error"))) {
                LoginActivity.open(this);
                return;
            }
            if (json.optBoolean("ok")) {
                Toast.makeText(this, "Review posted", Toast.LENGTH_SHORT).show();
                if (box != null) box.setText("");
            } else err(json.optString("error", "Review fail"));
        }, e -> err(e.getMessage()));
    }

    private void play(int s, int e) {
        getSharedPreferences("cineamit", 0).edit().putString("last_ep_" + type + "_" + id, s + "|" + e).apply();
        WatchActivity.open(this, type, id, item == null ? "" : item.title, s, e);
    }

    private void err(String m) {
        TextView t = findViewById(R.id.watchError);
        t.setText(m);
        t.setVisibility(View.VISIBLE);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
