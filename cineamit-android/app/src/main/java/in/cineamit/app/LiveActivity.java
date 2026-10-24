package in.cineamit.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.fragment.app.FragmentActivity;
import androidx.recyclerview.widget.ConcatAdapter;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.LiveChannel;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.data.Models.VodItem;
import in.cineamit.app.data.StalkerClient;
import in.cineamit.app.ui.LoadMoreFooter;
import in.cineamit.app.ui.Ui;

public class LiveActivity extends FragmentActivity {
    private String kind = "live";
    private String cat = "All";
    private String source = "all";
    private String region = "all";
    private String lang = "All";
    private static final String[][] REGIONS = {
            {"all", "All"},
            {"india", "India"},
            {"usa", "USA"},
            {"uk", "UK"},
            {"canada", "Canada"},
            {"pakistan", "Pakistan"},
            {"bangladesh", "Bangladesh"},
    };
    private String q = "";
    private int page = 1;
    private int totalPages = 1;
    private List<LiveChannel> allLive = new ArrayList<>();
    private List<LiveChannel> channels = new ArrayList<>();
    private static final int LIVE_PAGE = 80;
    private List<VodItem> vod = new ArrayList<>();
    private List<String> categories = new ArrayList<>();
    private List<String> liveSources = new ArrayList<>();
    private List<String> languages = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pending;
    private RecyclerView list;
    private LoadMoreFooter moreFoot;
    private boolean liveHasMore;
    private boolean sportOnly;
    private String topic = "";
    private ChannelAdapter liveAdapter;
    private VodAdapter vodAdapter;
    private String boundKind = "";

    public static void open(Context ctx) {
        ctx.startActivity(new Intent(ctx, LiveActivity.class));
    }

    public static void openSports(Context ctx) {
        openFiltered(ctx, true, null, null, "Sport", null);
    }

    public static void openFiltered(Context ctx, boolean sport, String region, String query, String title) {
        openFiltered(ctx, sport, region, query, title, null);
    }

    public static void openFiltered(Context ctx, boolean sport, String region, String query, String title, String topic) {
        Intent i = new Intent(ctx, LiveActivity.class);
        if (sport) i.putExtra("sport", true);
        if (region != null && !region.isEmpty()) i.putExtra("region", region);
        if (query != null && !query.isEmpty()) i.putExtra("query", query);
        if (title != null && !title.isEmpty()) i.putExtra("title", title);
        if (topic != null && !topic.isEmpty()) i.putExtra("topic", topic);
        ctx.startActivity(i);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_live);
        Intent in = getIntent();
        sportOnly = in != null && in.getBooleanExtra("sport", false);
        if (in != null) {
            String r = in.getStringExtra("region");
            if (r != null && !r.isEmpty()) region = r;
            String queryIn = in.getStringExtra("query");
            if (queryIn != null && !queryIn.isEmpty()) q = queryIn;
            String tpc = in.getStringExtra("topic");
            if (tpc != null && !tpc.isEmpty()) topic = tpc.toLowerCase();
        }
        String head = sportOnly ? "Sport" : "Live TV";
        if (in != null) {
            String t = in.getStringExtra("title");
            if (t != null && !t.isEmpty()) head = t;
        }
        Analytics.live();
        Ui.cineHeader(findViewById(android.R.id.content), head, v -> finish());
        findViewById(R.id.btnLogin).setOnClickListener(v -> LoginActivity.open(this));
        paintRegions();
        EditText query = findViewById(R.id.query);
        if (q != null && !q.isEmpty()) query.setText(q);
        query.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
            @Override public void onTextChanged(CharSequence s, int st, int b, int c) {}
            @Override public void afterTextChanged(Editable s) {
                q = s.toString();
                if (pending != null) handler.removeCallbacks(pending);
                pending = () -> {
                    if ("live".equals(kind) && !allLive.isEmpty()) {
                        page = 1;
                        applyLivePage();
                    } else load(true);
                };
                handler.postDelayed(pending, 280);
            }
        });
        list = findViewById(R.id.list);
        list.setLayoutManager(new GridLayoutManager(this, Ui.liveSpan(this)));
        Ui.padForIsland(list);
        load(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        View login = findViewById(R.id.btnLogin);
        if (Session.user != null && login != null && login.getVisibility() == View.VISIBLE) {
            login.setVisibility(View.GONE);
            load(true);
        }
    }

    private void paintRegions() {
        LinearLayout row = findViewById(R.id.kindsRow);
        View scroll = findViewById(R.id.kindsScroll);
        if (scroll != null) scroll.setVisibility(View.VISIBLE);
        if (row == null) return;
        row.removeAllViews();
        for (String[] r : REGIONS) {
            final String id = r[0];
            row.addView(Ui.chip(this, r[1], id.equals(region), v -> {
                region = id;
                page = 1;
                paintRegions();
                applyLivePage();
            }));
        }
    }

    private void load(boolean reset) {
        if (reset) {
            page = 1;
            channels.clear();
            vod.clear();
            findViewById(R.id.progress).setVisibility(View.VISIBLE);
            findViewById(R.id.status).setVisibility(View.GONE);
            findViewById(R.id.btnLogin).setVisibility(View.GONE);
            if (moreFoot != null) moreFoot.hide();
        }
        if ("live".equals(kind)) {
            if (Session.user != null && Session.user.is_kids) {
                findViewById(R.id.progress).setVisibility(View.GONE);
                status("Restricted in Kids Mode.");
                return;
            }
            if (!allLive.isEmpty() && !reset) {
                if (!liveHasMore) {
                    if (moreFoot != null) moreFoot.hide();
                    return;
                }
                page++;
                applyLivePage();
                findViewById(R.id.progress).setVisibility(View.GONE);
                return;
            }
            if (!allLive.isEmpty()) {
                page = 1;
                applyLivePage();
                findViewById(R.id.progress).setVisibility(View.GONE);
                return;
            }
            Io.run(this, () -> StalkerClient.channels(false), list -> {
                findViewById(R.id.progress).setVisibility(View.GONE);
                allLive = list == null ? new ArrayList<>() : list;
                page = 1;
                if (allLive.isEmpty()) {
                    status("Channels did not load on this device. Check the network and try again.");
                } else {
                    findViewById(R.id.status).setVisibility(View.GONE);
                }
                applyLivePage();
            }, this::fail);
        } else {
            int reqPage = reset ? 1 : page + 1;
            Io.run(this, () -> Api.iptv(kind, "all", "", q.trim(), reqPage, lang), json -> {
                findViewById(R.id.progress).setVisibility(View.GONE);
                if (!handleErr(json)) return;
                List<VodItem> items = Api.parseVodItems(json.optJSONArray("items"));
                page = reqPage;
                totalPages = Math.max(1, json.optInt("total_pages", 1));
                if (reset) vod = items;
                else {
                    Set<String> seen = new LinkedHashSet<>();
                    for (VodItem v : vod) seen.add(v.id);
                    for (VodItem v : items) if (!seen.contains(v.id)) vod.add(v);
                }
                languages = Api.stringList(json.optJSONArray("languages"));
                categories = Api.stringList(json.optJSONArray("categories"));
                if (vod.isEmpty()) status("No VOD titles. Check movies/series on Xtream/Stalker/M3U.");
                paintFilters();
                bindList();
            }, this::fail);
        }
    }

    private void applyLivePage() {
        String needle = q.trim().toLowerCase();
        List<LiveChannel> filtered = new ArrayList<>();
        LinkedHashSet<String> cats = new LinkedHashSet<>();
        cats.add("All");
        for (LiveChannel ch : allLive) {
            if (ch.category != null && !ch.category.isEmpty()) cats.add(ch.category);
            if (!"All".equalsIgnoreCase(cat) && ch.category != null && !ch.category.isEmpty()
                    && !cat.equalsIgnoreCase(ch.category)) continue;
            if (sportOnly && !sportMatch(ch)) continue;
            if (!topicMatch(ch)) continue;
            if (!regionMatch(ch)) continue;
            if (!needle.isEmpty()) {
                String blob = ((ch.name == null ? "" : ch.name) + " "
                        + (ch.category == null ? "" : ch.category)).toLowerCase();
                if (!blob.contains(needle)) continue;
            }
            filtered.add(ch);
        }
        categories = new ArrayList<>(cats);
        liveSources.clear();
        liveSources.add("stalker");
        int end = Math.min(Math.max(1, page) * LIVE_PAGE, filtered.size());
        channels = new ArrayList<>(filtered.subList(0, end));
        totalPages = Math.max(1, (int) Math.ceil(filtered.size() / (double) LIVE_PAGE));
        liveHasMore = end < filtered.size();
        if (filtered.isEmpty() && !allLive.isEmpty()) status("No live channels on this filter.");
        else if (!allLive.isEmpty()) findViewById(R.id.status).setVisibility(View.GONE);
        paintFilters();
        if (list != null) bindList();
    }

    private void playChannel(LiveChannel ch) {
        if (ch == null) return;
        if (ch.cmd != null && !ch.cmd.isEmpty()) {
            Toast.makeText(this, "Stream device pe khul raha hai…", Toast.LENGTH_SHORT).show();
            Io.run(this, () -> StalkerClient.resolvePlay(ch.cmd), url -> {
                if (url == null || url.isEmpty()) {
                    Toast.makeText(this, "Stream failed. Try the channel again.", Toast.LENGTH_LONG).show();
                    return;
                }
                PlayerActivity.openNative(LiveActivity.this, url, ch.name);
            }, e -> Toast.makeText(this, CineAmitApp.friendlyNetError(e), Toast.LENGTH_LONG).show());
            return;
        }
        String play = ch.play;
        if (play != null && !play.isEmpty() && play.startsWith("/")) play = Api.abs(play);
        if (play != null && !play.isEmpty() && !"device".equals(play)) {
            PlayerActivity.openNative(this, play, ch.name);
        }
    }

    private boolean handleErr(org.json.JSONObject json) {
        String err = json.optString("error");
        if ("login_required".equals(err)) {
            needLogin("live".equals(kind)
                    ? "Sign in for IPTV."
                    : "Sign in for movies, series, and anime.");
            return false;
        }
        if ("kids_restricted".equals(err)) {
            status("Restricted in Kids Mode.");
            return false;
        }
        if ("live_unavailable".equals(err)) {
            status("Live TV temporarily unavailable. Try again in a moment.");
            return false;
        }
        if (!json.optBoolean("ok", err.isEmpty()) && !err.isEmpty()) {
            status(err);
            return false;
        }
        return true;
    }

    private boolean sportMatch(LiveChannel ch) {
        String blob = ((ch.name == null ? "" : ch.name) + " " + (ch.category == null ? "" : ch.category)).toLowerCase();
        return blob.contains("sport") || blob.contains("cricket") || blob.contains("football")
                || blob.contains("soccer") || blob.contains("espn") || blob.contains("star sports")
                || blob.contains("tennis") || blob.contains("nba") || blob.contains("wwe")
                || blob.contains("f1") || blob.contains("hockey") || blob.contains("golf")
                || blob.contains("ufc") || blob.contains("boxing") || blob.contains("ipl");
    }

    private boolean topicMatch(LiveChannel ch) {
        if (topic == null || topic.isEmpty()) return true;
        String blob = ((ch.name == null ? "" : ch.name) + " " + (ch.category == null ? "" : ch.category)).toLowerCase();
        switch (topic) {
            case "news":
                return blob.contains("news") || blob.contains("cnn") || blob.contains("bbc")
                        || blob.contains("ndtv") || blob.contains("aaj tak") || blob.contains("india today")
                        || blob.contains("al jazeera") || blob.contains("cnbc") || blob.contains("sky news")
                        || blob.contains("zee news") || blob.contains("abp") || blob.contains("republic");
            case "movie":
                return blob.contains("movie") || blob.contains("cinema") || blob.contains("hbo")
                        || blob.contains("star movies") || blob.contains("zee cinema") || blob.contains("pictures")
                        || blob.contains("film") || blob.contains("movies");
            case "music":
                return blob.contains("music") || blob.contains("mtv") || blob.contains("9xm")
                        || blob.contains("vevo") || blob.contains("b4u") || blob.contains("mastiii")
                        || blob.contains("9x jalwa");
            case "cartoon":
                return blob.contains("cartoon") || blob.contains("kids") || blob.contains("disney")
                        || blob.contains("pogo") || blob.contains("nick") || blob.contains("hungama")
                        || blob.contains("baby tv") || blob.contains("cartoon network");
            case "entertainment":
                return blob.contains("entertainment") || blob.contains("zee tv") || blob.contains("colors")
                        || blob.contains("star plus") || blob.contains("sony tv") || blob.contains("sab tv")
                        || blob.contains("and tv") || blob.contains("star bharat") || blob.contains(" ent");
            default:
                return blob.contains(topic);
        }
    }

    private static boolean hasWord(String blob, String... words) {
        if (blob == null || blob.isEmpty()) return false;
        for (String w : words) {
            if (w == null || w.isEmpty()) continue;
            String needle = w.toLowerCase();
            int i = 0;
            while ((i = blob.indexOf(needle, i)) >= 0) {
                boolean before = i == 0 || !Character.isLetterOrDigit(blob.charAt(i - 1));
                int end = i + needle.length();
                boolean after = end >= blob.length() || !Character.isLetterOrDigit(blob.charAt(end));
                if (before && after) return true;
                i = end;
            }
        }
        return false;
    }

    private boolean regionMatch(LiveChannel ch) {
        if (region == null || "all".equalsIgnoreCase(region)) return true;
        String blob = ((ch.name == null ? "" : ch.name) + " " + (ch.category == null ? "" : ch.category)).toLowerCase();
        switch (region) {
            case "india":
                return hasWord(blob, "india", "indian", "hindi", "zee", "sony", "colors", "aaj tak")
                        || blob.contains("in:") || blob.contains("star ") || blob.contains("sun tv");
            case "usa":
                return hasWord(blob, "usa", "america", "cnn", "fox", "nbc", "cbs", "hbo", "espn")
                        || blob.contains("us ");
            case "uk":
                return hasWord(blob, "uk", "britain", "british", "bbc", "itv")
                        || blob.contains("sky ");
            case "canada":
                return hasWord(blob, "canada", "canadian", "ctv", "cbc");
            case "pakistan":
                return hasWord(blob, "pakistan", "pak", "geo", "ary") || blob.contains("hum tv");
            case "bangladesh":
                return hasWord(blob, "bangladesh", "bangla", "somoy");
            default:
                return hasWord(blob, region.toLowerCase());
        }
    }

    private void paintFilters() {
        LinearLayout row = findViewById(R.id.filtersRow);
        row.removeAllViews();
        if ("live".equals(kind)) {
            int n = 0;
            for (String c : categories) {
                if (c == null || c.isEmpty()) continue;
                row.addView(Ui.chip(this, c, c.equals(cat), v -> {
                    cat = c;
                    page = 1;
                    applyLivePage();
                }));
                if (++n >= 24) break;
            }
            return;
        }
        Set<String> sources = new LinkedHashSet<>();
        sources.add("all");
        for (VodItem it : vod) if (it.source != null && !it.source.isEmpty()) sources.add(it.source);
        if (sources.size() > 1) {
            for (String s : sources) {
                row.addView(Ui.chip(this, sourceLabel(s), s.equals(source), v -> {
                    source = s;
                    paintFilters();
                    bindList();
                }));
            }
        }
        if (languages.size() > 1) {
            for (String l : languages) {
                row.addView(Ui.chip(this, l, l.equals(lang), v -> {
                    lang = l;
                    load(true);
                }));
            }
        }
        if (categories.size() > 1) {
            for (String c : categories) {
                row.addView(Ui.chip(this, c, c.equals(cat), v -> {
                    cat = c;
                    paintFilters();
                    bindList();
                }));
            }
        }
    }

    private String sourceLabel(String s) {
        if ("m3u".equals(s)) return "M3U";
        if ("xtream".equals(s)) return "Xtream";
        if ("stalker".equals(s)) return "Stalker";
        return "All sources";
    }

    private void bindList() {
        if ("live".equals(kind)) {
            boolean passAll = "all".equalsIgnoreCase(source) && "All".equalsIgnoreCase(cat) && q.trim().isEmpty();
            List<LiveChannel> filtered = new ArrayList<>();
            if (passAll) {
                filtered.addAll(channels);
            } else {
                String needle = q.trim().toLowerCase();
                for (LiveChannel ch : channels) {
                    if (!"all".equalsIgnoreCase(source) && ch.source != null && !ch.source.isEmpty()
                            && !source.equalsIgnoreCase(ch.source)) continue;
                    if (!"All".equalsIgnoreCase(cat) && ch.category != null && !ch.category.isEmpty()
                            && !cat.equalsIgnoreCase(ch.category)) continue;
                    if (!needle.isEmpty()) {
                        String blob = ((ch.name == null ? "" : ch.name) + " " + (ch.category == null ? "" : ch.category)).toLowerCase();
                        if (!blob.contains(needle)) continue;
                    }
                    filtered.add(ch);
                }
            }
            if (liveAdapter == null) liveAdapter = new ChannelAdapter(filtered);
            else liveAdapter.replace(filtered, page <= 1);
            bindGrid(liveAdapter, liveHasMore, Ui.liveSpan(this));
        } else {
            String needle = q.trim().toLowerCase();
            List<VodItem> filtered = new ArrayList<>();
            for (VodItem it : vod) {
                if (!"all".equals(source) && !source.equals(it.source)) continue;
                if (!"All".equals(cat) && !cat.equals(it.category)) continue;
                if (!needle.isEmpty() && !it.name.toLowerCase().contains(needle)) continue;
                filtered.add(it);
            }
            if (vodAdapter == null) vodAdapter = new VodAdapter(filtered);
            else vodAdapter.replace(filtered, page <= 1);
            bindGrid(vodAdapter, page < totalPages, Ui.liveSpan(this));
        }
    }

    private void bindGrid(RecyclerView.Adapter<?> inner, boolean hasMore, int span) {
        int cols = span > 0 ? span : Ui.liveSpan(this);
        boolean attached = list.getAdapter() != null && moreFoot != null && kind.equals(boundKind)
                && list.getAdapter() instanceof ConcatAdapter;
        if (!attached) {
            moreFoot = new LoadMoreFooter(() -> load(false));
            LoadMoreFooter.attach(list, inner, moreFoot, cols);
            boundKind = kind;
        }
        if (hasMore) moreFoot.idle(true);
        else moreFoot.hide();
    }

    private void needLogin(String m) {
        status(m);
        findViewById(R.id.btnLogin).setVisibility(View.VISIBLE);
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

    @Override
    protected void onDestroy() {
        if (pending != null) handler.removeCallbacks(pending);
        super.onDestroy();
    }

    class ChannelAdapter extends RecyclerView.Adapter<ChannelAdapter.VH> {
        final List<LiveChannel> data = new ArrayList<>();
        ChannelAdapter(List<LiveChannel> first) { replace(first, true); }
        void replace(List<LiveChannel> next, boolean reset) {
            int old = data.size();
            data.clear();
            if (next != null) data.addAll(next);
            if (reset || old == 0 || data.size() <= old) {
                notifyDataSetChanged();
                if (reset && list != null) list.scrollToPosition(0);
            } else {
                notifyItemRangeInserted(old, data.size() - old);
            }
        }
        @NonNull
        @Override
        public VH onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new VH(LayoutInflater.from(parent.getContext()).inflate(R.layout.item_live_card, parent, false));
        }
        @Override
        public void onBindViewHolder(@NonNull VH h, int position) {
            LiveChannel ch = data.get(position);
            ((TextView) h.itemView.findViewById(R.id.name)).setText(ch.name);
            TextView live = h.itemView.findViewById(R.id.live);
            boolean on = (ch.cmd != null && !ch.cmd.isEmpty())
                    || (ch.play != null && !ch.play.isEmpty() && !"device".equals(ch.play));
            String catLabel = ch.category == null || ch.category.isEmpty() ? (on ? "LIVE" : "Offline") : ch.category;
            live.setText(catLabel);
            live.setTextColor(on ? 0xFFF87171 : 0xFF9C9C9C);
            String logo = ch.logo;
            if (logo != null && !logo.isEmpty() && !logo.startsWith("http")) logo = Api.abs(logo);
            android.widget.ImageView iv = h.itemView.findViewById(R.id.logo);
            View fallback = h.itemView.findViewById(R.id.fallback);
            if (logo == null || logo.isEmpty()) {
                iv.setVisibility(View.GONE);
                if (fallback != null) fallback.setVisibility(View.VISIBLE);
            } else {
                iv.setVisibility(View.VISIBLE);
                Images.loadContain(iv, logo, () -> {
                    if (fallback != null) fallback.setVisibility(View.GONE);
                }, () -> {
                    iv.setVisibility(View.GONE);
                    if (fallback != null) fallback.setVisibility(View.VISIBLE);
                });
            }
            h.itemView.setOnClickListener(v -> playChannel(ch));
        }
        @Override public int getItemCount() { return data.size(); }
        class VH extends RecyclerView.ViewHolder { VH(View v) { super(v); } }
    }

    class VodAdapter extends RecyclerView.Adapter<VodAdapter.VH> {
        final List<VodItem> data = new ArrayList<>();
        VodAdapter(List<VodItem> first) { replace(first, true); }
        void replace(List<VodItem> next, boolean reset) {
            int old = data.size();
            data.clear();
            if (next != null) data.addAll(next);
            if (reset || old == 0 || data.size() <= old) {
                notifyDataSetChanged();
                if (reset && list != null) list.scrollToPosition(0);
            } else {
                notifyItemRangeInserted(old, data.size() - old);
            }
        }
        @NonNull
        @Override
        public VH onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new VH(LayoutInflater.from(parent.getContext()).inflate(R.layout.item_channel, parent, false));
        }
        @Override
        public void onBindViewHolder(@NonNull VH h, int position) {
            VodItem it = data.get(position);
            ((TextView) h.itemView.findViewById(R.id.name)).setText(it.name);
            ((TextView) h.itemView.findViewById(R.id.meta)).setText(it.year);
            ((TextView) h.itemView.findViewById(R.id.live)).setText(it.has_episodes ? "Series" : "Play");
            String logo = it.logo;
            if (logo != null && !logo.isEmpty() && !logo.startsWith("http")) logo = Api.abs(logo);
            Images.load(h.itemView.findViewById(R.id.logo), logo);
            h.itemView.setOnClickListener(v -> {
                if (it.has_episodes) VodSeriesActivity.open(LiveActivity.this, it.id);
                else if (it.play != null && !it.play.isEmpty()) {
                    PlayerActivity.openNative(LiveActivity.this, it.play, it.name);
                }
            });
        }
        @Override public int getItemCount() { return data.size(); }
        class VH extends RecyclerView.ViewHolder { VH(View v) { super(v); } }
    }
}
