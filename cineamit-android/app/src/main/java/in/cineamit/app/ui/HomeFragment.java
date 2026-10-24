package in.cineamit.app.ui;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import androidx.activity.OnBackPressedCallback;
import androidx.recyclerview.widget.GridLayoutManager;

import in.cineamit.app.Ads;
import in.cineamit.app.BrowseActivity;
import in.cineamit.app.CatalogActivity;
import in.cineamit.app.CineAmitApp;
import in.cineamit.app.Images;
import in.cineamit.app.Io;
import in.cineamit.app.ListActivity;
import in.cineamit.app.LiveActivity;
import in.cineamit.app.LoginActivity;
import in.cineamit.app.MainActivity;
import in.cineamit.app.PageActivity;
import in.cineamit.app.R;
import in.cineamit.app.Sub;
import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.HomeRow;
import in.cineamit.app.data.Models.MediaItem;
import in.cineamit.app.data.Models.Provider;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.data.Models.Studio;

public class HomeFragment extends Fragment {
    private View root;
    private final List<MediaItem> hero = new ArrayList<>();
    private final List<Rail> rails = new ArrayList<>();
    private RailsAdapter railsAdapter;
    private int editorialIndex;
    private final Handler sliderHandler = new Handler(Looper.getMainLooper());
    private Runnable sliderLoop;
    private final Handler searchHandler = new Handler(Looper.getMainLooper());
    private Runnable searchPending;
    private PosterAdapter searchAdapter;
    private int searchGen;
    private OnBackPressedCallback searchBack;
    private View heroView;
    private boolean heroDirty;
    private boolean loadedOnce;
    private long resumeUserKey = Long.MIN_VALUE;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        root = inflater.inflate(R.layout.fragment_home, container, false);
        root.findViewById(R.id.lyt_not_found).setOnClickListener(v -> load());
        RecyclerView rv = root.findViewById(R.id.rv_home);
        rv.setLayoutManager(new LinearLayoutManager(requireContext()));
        Ui.padForIsland(rv);
        railsAdapter = new RailsAdapter();
        rv.setAdapter(railsAdapter);
        setupSearch();
        load();
        return root;
    }

    @Override
    public void onConfigurationChanged(@NonNull android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (heroView != null) sizeHero(heroView);
        if (root == null) return;
        RecyclerView grid = root.findViewById(R.id.homeSearchGrid);
        if (grid != null && grid.getLayoutManager() instanceof GridLayoutManager) {
            ((GridLayoutManager) grid.getLayoutManager()).setSpanCount(Ui.posterSpan(requireContext()));
        }
        if (railsAdapter != null) railsAdapter.notifyDataSetChanged();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!loadedOnce) return;
        long key = 0;
        if (Session.user != null) key = Session.user.id * 100000L + Session.user.profile_id;
        if (key != resumeUserKey) {
            resumeUserKey = key;
            load();
            return;
        }
        if (hero.size() > 1 && !searchOpen()) startSlider();
    }

    @Override
    public void onPause() {
        stopSlider();
        super.onPause();
    }

    @Override
    public void onDestroyView() {
        stopSlider();
        if (searchPending != null) searchHandler.removeCallbacks(searchPending);
        View overlay = root != null ? root.findViewById(R.id.homeSearchOverlay) : null;
        if (overlay != null) overlay.animate().cancel();
        heroView = null;
        super.onDestroyView();
    }

    private void setupSearch() {
        View btn = root.findViewById(R.id.btnHomeSearch);
        if (btn != null) {
            Motion.press(btn);
            btn.setOnClickListener(v -> openSearch());
        }
        View close = root.findViewById(R.id.btnCloseSearch);
        if (close != null) close.setOnClickListener(v -> closeSearch());
        Ui.padTopInset(root.findViewById(R.id.homeSearchBar));
        RecyclerView grid = root.findViewById(R.id.homeSearchGrid);
        grid.setLayoutManager(Ui.posterGrid(requireContext()));
        Ui.padForIsland(grid);
        searchAdapter = new PosterAdapter(item -> MainActivity.openDetails(requireContext(), item.media_type, item.id), true);
        grid.setAdapter(searchAdapter);
        EditText q = root.findViewById(R.id.homeQuery);
        q.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
            @Override public void onTextChanged(CharSequence s, int st, int b, int c) {}
            @Override public void afterTextChanged(Editable s) {
                if (searchPending != null) searchHandler.removeCallbacks(searchPending);
                final String query = s.toString().trim();
                searchPending = () -> liveSearch(query);
                searchHandler.postDelayed(searchPending, query.length() >= 2 ? 140 : 0);
            }
        });
        searchBack = new OnBackPressedCallback(false) {
            @Override public void handleOnBackPressed() { closeSearch(); }
        };
        requireActivity().getOnBackPressedDispatcher().addCallback(getViewLifecycleOwner(), searchBack);
    }

    private void openSearch() {
        View overlay = root.findViewById(R.id.homeSearchOverlay);
        overlay.setVisibility(View.VISIBLE);
        overlay.setAlpha(0f);
        overlay.animate().alpha(1f).setDuration(180).start();
        EditText q = root.findViewById(R.id.homeQuery);
        q.requestFocus();
        InputMethodManager imm = (InputMethodManager) requireContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.showSoftInput(q, InputMethodManager.SHOW_IMPLICIT);
        if (searchBack != null) searchBack.setEnabled(true);
        stopSlider();
        setIslandVisible(false);
        if (q.getText().toString().trim().length() < 2) {
            root.findViewById(R.id.homeSearchStatus).setVisibility(View.VISIBLE);
            ((TextView) root.findViewById(R.id.homeSearchStatus)).setText("Type a title — results appear live.");
        }
    }

    private void closeSearch() {
        if (root == null) return;
        View overlay = root.findViewById(R.id.homeSearchOverlay);
        if (overlay == null || overlay.getVisibility() != View.VISIBLE) return;
        overlay.animate().cancel();
        overlay.animate().alpha(0f).setDuration(140).withEndAction(() -> {
            if (!isAdded() || root == null) return;
            overlay.setVisibility(View.GONE);
        }).start();
        EditText q = root.findViewById(R.id.homeQuery);
        q.setText("");
        if (searchAdapter != null) searchAdapter.setItems(null);
        InputMethodManager imm = (InputMethodManager) requireContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(q.getWindowToken(), 0);
        if (searchBack != null) searchBack.setEnabled(false);
        setIslandVisible(true);
        startSlider();
    }

    private void setIslandVisible(boolean show) {
        if (getActivity() == null) return;
        View island = getActivity().findViewById(R.id.islandNav);
        if (island != null) island.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private void liveSearch(String query) {
        TextView status = root.findViewById(R.id.homeSearchStatus);
        View progress = root.findViewById(R.id.homeSearchProgress);
        if (query.length() < 2) {
            searchGen++;
            if (searchAdapter != null) searchAdapter.setItems(null);
            progress.setVisibility(View.GONE);
            status.setVisibility(View.VISIBLE);
            status.setText(query.isEmpty() ? "Type a title — results appear live." : "Two more letters…");
            return;
        }
        final int gen = ++searchGen;
        progress.setVisibility(View.VISIBLE);
        status.setVisibility(View.GONE);
        Io.run(this, () -> Api.search(query), json -> {
            if (gen != searchGen) return;
            progress.setVisibility(View.GONE);
            Api.applyMeta(json);
            searchAdapter.setItems(Api.parseItems(json.optJSONArray("items") != null
                    ? json.optJSONArray("items") : json.optJSONArray("results")));
            if (searchAdapter.getItemCount() == 0) {
                status.setText("No matches for \"" + query + "\"");
                status.setVisibility(View.VISIBLE);
            }
        }, e -> {
            if (gen != searchGen) return;
            progress.setVisibility(View.GONE);
            status.setText(CineAmitApp.friendlyNetError(e));
            status.setVisibility(View.VISIBLE);
        });
    }

    public void scrollToTop() {
        if (root == null) return;
        RecyclerView rv = root.findViewById(R.id.rv_home);
        if (rv != null) rv.smoothScrollToPosition(0);
    }

    private void load() {
        stopSlider();
        root.findViewById(R.id.progressBar1).setVisibility(View.VISIBLE);
        root.findViewById(R.id.lyt_not_found).setVisibility(View.GONE);
        root.findViewById(R.id.rv_home).setVisibility(View.VISIBLE);
        Io.run(this, Api::home, json -> {
            root.findViewById(R.id.progressBar1).setVisibility(View.GONE);
            if (!json.optBoolean("ok", true) && json.has("error")) {
                String err = json.optString("error", "Home load failed");
                if ("html".equals(err) || err.startsWith("http_")) {
                    err = "Server is not returning JSON. Update Node with cineamit.zip and reinstall the app.";
                }
                status(err);
                return;
            }
            Api.applyMeta(json);
            hero.clear();
            hero.addAll(Api.parseItems(json.optJSONArray("hero")));
            List<HomeRow> rows = Api.parseRows(json.optJSONArray("rows"));
            List<Studio> studios = Api.parseStudios(json.optJSONArray("studios"));
            List<Provider> providers = Api.parseProviders(json.optJSONArray("providers"));
            if (hero.isEmpty() && !rows.isEmpty() && rows.get(0).items != null) {
                hero.addAll(rows.get(0).items);
            }
            for (MediaItem it : hero) {
                Images.preload(Api.img(Session.imageBase, Images.artPath(it), "w500"));
            }
            rails.clear();
            if (providers != null && !providers.isEmpty()) {
                rails.add(Rail.providers(providers));
            }
            rails.add(moodRail());
            boolean kids = Session.user != null && Session.user.is_kids;
            if (!kids) rails.add(liveRail());
            if (!kids && Ads.rewardOn()) rails.add(earnRail());
            if (studios != null && !studios.isEmpty()) {
                rails.add(Rail.studios(studios));
            }
            for (HomeRow row : rows) {
                if (row.items == null || row.items.isEmpty()) continue;
                if ("trending".equals(row.id)) {
                    List<MediaItem> clean = new ArrayList<>();
                    for (MediaItem it : row.items) {
                        if (it != null && !"person".equals(it.media_type)) clean.add(it);
                    }
                    row.items = clean;
                    if (row.items.isEmpty()) continue;
                }
                String kind = row.browse;
                if (kind == null || kind.isEmpty()) {
                    if ("movies".equals(row.id)) kind = "movie";
                    else if ("tv".equals(row.id)) kind = "tv";
                    else if ("anime".equals(row.id)) kind = "anime";
                    else if ("actors".equals(row.id)) kind = "actors";
                    else kind = null;
                }
                rails.add(Rail.posters(row.title, row.items, kind, row.id));
            }
            if (Ads.bannersOn() && Sub.adsHomeBanners()) {
                List<Rail> mixed = new ArrayList<>();
                int n = 0;
                for (Rail r : rails) {
                    mixed.add(r);
                    if ("ad".equals(r.id)) continue;
                    n++;
                    if (n % 3 == 0) mixed.add(Rail.ad());
                }
                rails.clear();
                rails.addAll(mixed);
            }
            if (Ads.bannersOn() && Sub.adsBannerTop()) rails.add(0, Rail.ad());
            if (hero.isEmpty() && rails.isEmpty()) {
                status("No titles yet. Check server URL and TMDB key.");
                return;
            }
            heroDirty = true;
            loadedOnce = true;
            long key = 0;
            if (Session.user != null) key = Session.user.id * 100000L + Session.user.profile_id;
            resumeUserKey = key;
            railsAdapter.notifyDataSetChanged();
            if (hero.size() > 1 && getResources().getBoolean(R.bool.isAutoSlide) && !searchOpen()) startSlider();
        }, e -> {
            root.findViewById(R.id.progressBar1).setVisibility(View.GONE);
            status(CineAmitApp.friendlyNetError(e));
        });
    }

    private void status(String msg) {
        stopSlider();
        root.findViewById(R.id.rv_home).setVisibility(View.GONE);
        root.findViewById(R.id.lyt_not_found).setVisibility(View.VISIBLE);
        TextView t = root.findViewById(R.id.textNotFound);
        if (t != null) t.setText(msg);
    }

    private View heroRoot() {
        return heroView != null ? heroView : root;
    }

    private void bindHero(int index) {
        if (hero.isEmpty() || heroRoot() == null) return;
        editorialIndex = Math.max(0, Math.min(index, hero.size() - 1));
        MediaItem item = hero.get(editorialIndex);
        View hv = heroRoot();
        View brand = hv.findViewById(R.id.editorialBrandRow);
        if (brand != null && brand.getTag(R.id.tag_motion_entered) == null) {
            Ui.padTopInset(brand);
            Motion.rise(brand, 40);
            brand.setTag(R.id.tag_motion_entered, Boolean.TRUE);
        }
        View searchBtn = hv.findViewById(R.id.btnHomeSearch);
        if (searchBtn != null) {
            Motion.press(searchBtn);
            searchBtn.setOnClickListener(v -> openSearch());
        }
        sizeHero(hv);
        paintBackdrop(item);
        ImageView titleImg = hv.findViewById(R.id.editorialTitleImg);
        if (titleImg != null) titleImg.setVisibility(View.GONE);
        TextView l1 = hv.findViewById(R.id.editorialLine1);
        TextView l2 = hv.findViewById(R.id.editorialLine2);
        if (l1 != null) {
            l1.setVisibility(View.VISIBLE);
            l1.setText(item.title == null ? "" : item.title);
        }
        if (l2 != null) {
            l2.setVisibility(View.VISIBLE);
            String meta = typeLabel(item.media_type);
            if (item.vote_average > 0) meta = meta + "  ·  ★ " + String.format(java.util.Locale.US, "%.1f", item.vote_average);
            l2.setText(meta);
        }
        TextView idx = hv.findViewById(R.id.editorialIndex);
        if (idx != null) idx.setText(String.format("%d / %d", editorialIndex + 1, hero.size()));
        TextView year = hv.findViewById(R.id.editorialYear);
        if (year != null) year.setText(item.year == null || item.year.isEmpty() ? "—" : item.year);
        TextView rt = hv.findViewById(R.id.editorialRuntime);
        if (rt != null) rt.setText(item.runtime > 0 ? (item.runtime / 60) + "h " + (item.runtime % 60) + "m" : typeLabel(item.media_type));
        TextView score = hv.findViewById(R.id.editorialScore);
        if (score != null) {
            if (item.vote_average > 0) {
                score.setVisibility(View.VISIBLE);
                score.setText(String.format(java.util.Locale.US, "%.1f", item.vote_average));
            } else score.setVisibility(View.GONE);
        }
        View watch = hv.findViewById(R.id.editorialWatch);
        if (watch != null) {
            watch.setOnClickListener(v -> MainActivity.openDetails(requireContext(), item.media_type, item.id));
            Motion.press(watch);
        }
        View frame = hv.findViewById(R.id.editorialPosterFrame);
        if (frame != null) {
            frame.setOnClickListener(v -> MainActivity.openDetails(requireContext(), item.media_type, item.id));
            frame.setOnTouchListener((v, ev) -> {
                int act = ev.getActionMasked();
                if (act == android.view.MotionEvent.ACTION_DOWN) stopSlider();
                else if (act == android.view.MotionEvent.ACTION_UP || act == android.view.MotionEvent.ACTION_CANCEL) {
                    startSlider();
                }
                return false;
            });
        }
        paintFilmstrip();
    }

    private void sizeHero(View hv) {
        if (hv == null) return;
        Ui.sizeHeroFrame(hv.findViewById(R.id.editorialPosterFrame));
    }

    private void paintBackdrop(MediaItem item) {
        View hv = heroRoot();
        if (hv == null) return;
        ImageView poster = hv.findViewById(R.id.editorialPoster);
        if (poster != null) Images.loadPoster(poster, item);
        if (hero.size() > 1) {
            MediaItem next = hero.get((editorialIndex + 1) % hero.size());
            Images.preload(Api.img(Session.imageBase, Images.artPath(next), "w500"));
        }
    }

    private void paintFilmstrip() {
        LinearLayout strip = heroRoot().findViewById(R.id.filmstrip);
        if (strip == null) return;
        int max = Math.min(hero.size(), 12);
        if (strip.getChildCount() != max) {
            strip.removeAllViews();
            LayoutInflater inf = LayoutInflater.from(requireContext());
            for (int i = 0; i < max; i++) {
                final int pos = i;
                View cell = inf.inflate(R.layout.item_hero_pick, strip, false);
                ImageView thumb = cell.findViewById(R.id.thumb);
                Images.loadPoster(thumb, hero.get(i));
                Motion.press(cell);
                cell.setOnClickListener(v -> {
                    bindHero(pos);
                    startSlider();
                });
                strip.addView(cell);
            }
        }
        for (int i = 0; i < max; i++) {
            View cell = strip.getChildAt(i);
            if (cell != null) {
                cell.setBackgroundResource(i == editorialIndex
                        ? R.drawable.film_frame_purple_on
                        : R.drawable.poster_purple_frame);
            }
        }
    }

    private void startSlider() {
        stopSlider();
        if (hero.size() <= 1) return;
        sliderLoop = () -> {
            if (!isAdded() || hero.size() <= 1) return;
            bindHero((editorialIndex + 1) % hero.size());
            sliderHandler.postDelayed(sliderLoop, 6500);
        };
        sliderHandler.postDelayed(sliderLoop, 6500);
    }

    private void stopSlider() {
        if (sliderLoop != null) sliderHandler.removeCallbacks(sliderLoop);
        sliderLoop = null;
    }

    private static String typeLabel(String type) {
        if ("tv".equals(type)) return "Series";
        if ("anime".equals(type)) return "Anime";
        return "Movie";
    }

    static final class Shortcut {
        final String emoji;
        final String label;
        final int tint;
        final String action;

        Shortcut(String emoji, String label, int tint, String action) {
            this.emoji = emoji;
            this.label = label;
            this.tint = tint;
            this.action = action;
        }
    }

    static final class Rail {
        final String id;
        final String title;
        final List<MediaItem> items;
        final String browseKind;
        final List<Studio> studios;
        final List<Provider> providers;
        final List<Shortcut> shortcuts;

        private Rail(String id, String title, List<MediaItem> items, String browseKind,
                     List<Studio> studios, List<Provider> providers, List<Shortcut> shortcuts) {
            this.id = id == null ? "" : id;
            this.title = title;
            this.items = items;
            this.browseKind = browseKind;
            this.studios = studios;
            this.providers = providers;
            this.shortcuts = shortcuts;
        }

        static Rail posters(String title, List<MediaItem> items, String browseKind, String id) {
            return new Rail(id, title, items, browseKind, null, null, null);
        }

        static Rail studios(List<Studio> studios) {
            return new Rail("studios", "Studios", null, "studios", studios, null, null);
        }

        static Rail providers(List<Provider> providers) {
            return new Rail("providers", "Watch on", null, "providers", null, providers, null);
        }

        static Rail chips(String id, String title, List<Shortcut> shortcuts) {
            return new Rail(id, title, null, id, null, null, shortcuts);
        }

        static Rail ad() {
            return new Rail("ad", "", null, "", null, null, null);
        }
    }

    private Rail moodRail() {
        boolean kids = Session.user != null && Session.user.is_kids;
        List<Shortcut> list = new ArrayList<>();
        if (kids) {
            list.add(new Shortcut("😄", "Chill & Laugh", 0xFFFBBF24, "genre:35,16:Chill · Laugh it off"));
            list.add(new Shortcut("🏡", "Family", 0xFF34D399, "genre:10751:Family"));
        } else {
            list.add(new Shortcut("😄", "Chill & Laugh", 0xFFFBBF24, "genre:35:Chill · Laugh it off"));
            list.add(new Shortcut("⚡", "Adrenaline Rush", 0xFF60A5FA, "genre:28:Thrill · Adrenaline"));
            list.add(new Shortcut("👻", "Horror Night", 0xFF9CA3AF, "genre:27:Scary · Nightmares"));
            list.add(new Shortcut("🧠", "Mind-Bending", 0xFFC4B5FD, "genre:878:Mind-bending · Sci-Fi"));
            list.add(new Shortcut("💜", "Romantic Vibe", 0xFFF472B6, "genre:10749:Romantic Night"));
        }
        return Rail.chips("mood", "How are you feeling?", list);
    }

    private Rail earnRail() {
        List<Shortcut> list = new ArrayList<>();
        list.add(new Shortcut("▶", "Watch ad  ·  +" + Sub.adPoints() + " pts", 0xFFC4B5FD, "earn"));
        return Rail.chips("earn", "Earn points", list);
    }

    private Rail liveRail() {
        List<Shortcut> list = new ArrayList<>();
        list.add(new Shortcut("🏆", "Live Sports", 0xFF60A5FA, "live:sport"));
        list.add(new Shortcut("🇮🇳", "India Channels", 0xFFFB923C, "live:india"));
        list.add(new Shortcut("⭐", "Entertainment", 0xFFF472B6, "live:topic:entertainment"));
        list.add(new Shortcut("📰", "Live News", 0xFFF87171, "live:topic:news"));
        list.add(new Shortcut("🎬", "Movies 24/7", 0xFFC4B5FD, "live:topic:movie"));
        list.add(new Shortcut("🎵", "Music & MTV", 0xFF4ADE80, "live:topic:music"));
        list.add(new Shortcut("🎈", "Kids Cartoons", 0xFFFACC15, "live:topic:cartoon"));
        return Rail.chips("livetv", "Live TV Channels", list);
    }

    private void openShortcut(Shortcut s) {
        if (s == null || s.action == null || !isAdded()) return;
        android.content.Context ctx = requireContext();
        String a = s.action;
        if ("earn".equals(a)) {
            earnAd();
            return;
        }
        if (a.startsWith("genre:")) {
            String rest = a.substring(6);
            int cut = rest.indexOf(':');
            String genreId = cut < 0 ? rest : rest.substring(0, cut);
            String title = cut < 0 ? s.label : rest.substring(cut + 1);
            BrowseActivity.openGenre(ctx, "movie", title, genreId);
            return;
        }
        if ("live:sport".equals(a)) {
            LiveActivity.openSports(ctx);
            return;
        }
        if ("live:india".equals(a)) {
            LiveActivity.openFiltered(ctx, false, "india", null, "India Channels");
            return;
        }
        if (a.startsWith("live:topic:")) {
            LiveActivity.openFiltered(ctx, false, null, null, s.label, a.substring(11));
        }
    }

    private boolean searchOpen() {
        if (root == null) return false;
        View overlay = root.findViewById(R.id.homeSearchOverlay);
        return overlay != null && overlay.getVisibility() == View.VISIBLE;
    }

    private void openItem(android.content.Context ctx, MediaItem item) {
        if (item == null) return;
        if ("collection".equals(item.media_type)) {
            PageActivity.open(ctx, "album", String.valueOf(item.id));
            return;
        }
        if ("person".equals(item.media_type)) {
            MainActivity.openDetails(ctx, "person", item.id);
            return;
        }
        MainActivity.openDetails(ctx, item.media_type, item.id);
    }

    private void earnAd() {
        if (!isAdded()) return;
        if (Session.user == null) {
            android.widget.Toast.makeText(requireContext(), "Sign in to earn points.", android.widget.Toast.LENGTH_SHORT).show();
            LoginActivity.open(requireContext());
            return;
        }
        android.app.Activity act = getActivity();
        if (act == null) return;
        Ads.showRewarded(act, earned -> {
            if (!Io.alive(this)) return;
            if (earned == null || !earned.optBoolean("ok")) {
                android.widget.Toast.makeText(requireContext(), "Points were not added.", android.widget.Toast.LENGTH_SHORT).show();
                return;
            }
            Sub.applyRemote(earned);
            int add = earned.optInt("added", Sub.adPoints());
            android.widget.Toast.makeText(requireContext(), "+" + add + " pts  ·  total " + Sub.points(), android.widget.Toast.LENGTH_SHORT).show();
        });
    }

    private void openRail(Rail rail) {
        if ("earn".equals(rail.id) || "earn".equals(rail.browseKind)) {
            earnAd();
            return;
        }
        if ("mood".equals(rail.id) || "mood".equals(rail.browseKind)) {
            PageActivity.open(requireContext(), "mood");
            return;
        }
        if ("livetv".equals(rail.id) || "livetv".equals(rail.browseKind)) {
            LiveActivity.open(requireContext());
            return;
        }
        if ("studios".equals(rail.browseKind) || "providers".equals(rail.browseKind)) {
            ListActivity.open(requireContext(), rail.browseKind);
            return;
        }
        if ("actors".equals(rail.browseKind) || "person".equals(rail.browseKind)) {
            PageActivity.open(requireContext(), "actors");
            return;
        }
        if ("albums".equals(rail.browseKind)) {
            PageActivity.open(requireContext(), "albums");
            return;
        }
        if ("continue".equals(rail.id) || "watchlist".equals(rail.id)) {
            if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).go("watchlist");
            return;
        }
        if (rail.browseKind == null || rail.browseKind.isEmpty()) return;
        String pageTitle = rail.title == null || rail.title.isEmpty() ? "Browse" : rail.title;
        String cat = categoryFor(rail.id, rail.browseKind);
        BrowseActivity.open(requireContext(), rail.browseKind, pageTitle, cat);
    }

    private static String categoryFor(String id, String kind) {
        if (id == null) id = "";
        switch (id) {
            case "india":
            case "indian":
                return "indian";
            case "bollywood":
            case "hollywood":
            case "south":
            case "korean":
            case "netflix":
            case "prime":
            case "apple":
            case "cartoons":
            case "cartoons_top":
            case "top_shows":
            case "now_playing":
            case "top_rated":
            case "upcoming":
                return "cartoons_top".equals(id) ? "cartoons" : id;
            default:
                return "popular";
        }
    }

    class RailsAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
        static final int TYPE_HERO = 0;
        static final int TYPE_RAIL = 1;
        static final int TYPE_AD = 2;

        private boolean hasHero() {
            return !hero.isEmpty();
        }

        private Rail railAt(int position) {
            return rails.get(hasHero() ? position - 1 : position);
        }

        @Override
        public int getItemViewType(int position) {
            if (hasHero() && position == 0) return TYPE_HERO;
            Rail r = railAt(position);
            return r != null && "ad".equals(r.id) ? TYPE_AD : TYPE_RAIL;
        }

        @NonNull
        @Override
        public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            if (viewType == TYPE_HERO) {
                View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_home_hero, parent, false);
                ViewGroup.LayoutParams lp = v.getLayoutParams();
                if (lp == null) {
                    lp = new RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                } else {
                    lp.height = ViewGroup.LayoutParams.WRAP_CONTENT;
                    lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
                }
                v.setLayoutParams(lp);
                sizeHero(v);
                HeroVH hv = new HeroVH(v);
                hv.setIsRecyclable(false);
                return hv;
            }
            if (viewType == TYPE_AD) {
                return new AdVH(LayoutInflater.from(parent.getContext()).inflate(R.layout.item_home_ad, parent, false));
            }
            return new VH(LayoutInflater.from(parent.getContext()).inflate(R.layout.home_row_item, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull RecyclerView.ViewHolder holder, int position) {
            if (holder instanceof HeroVH) {
                heroView = holder.itemView;
                heroDirty = false;
                bindHero(editorialIndex);
                return;
            }
            if (holder instanceof AdVH) {
                Ads.fillBanner(holder.itemView.getContext(), ((AdVH) holder).slot);
                return;
            }
            VH h = (VH) holder;
            Rail rail = railAt(position);
            Context ctx = h.itemView.getContext();
            Motion.fadeUp(h.itemView, Math.min(position, 6) * 50L);
            h.title.setText(rail.title);
            View.OnClickListener all = v -> openRail(rail);
            h.viewAll.setOnClickListener(all);
            h.title.setOnClickListener(all);
            boolean canAll = rail.browseKind != null && !rail.browseKind.isEmpty()
                    && !"earn".equals(rail.id) && !"mood".equals(rail.id);
            h.viewAll.setVisibility(canAll ? View.VISIBLE : View.GONE);
            h.list.setVisibility(View.VISIBLE);
            h.list.setNestedScrollingEnabled(false);
            if (h.list.getLayoutManager() == null) {
                h.list.setLayoutManager(new LinearLayoutManager(ctx, RecyclerView.HORIZONTAL, false));
            }
            if (rail.shortcuts != null) {
                h.posters = null;
                h.list.setAdapter(new ShortcutAdapter(rail.shortcuts));
            } else if (rail.providers != null) {
                h.posters = null;
                h.list.setAdapter(BrandAdapter.providers(rail.providers, false, item ->
                        BrandAdapter.openProvider(ctx, item)));
            } else if (rail.studios != null) {
                h.posters = null;
                h.list.setAdapter(BrandAdapter.studios(rail.studios, false, item ->
                        BrandAdapter.openStudio(ctx, item)));
            } else if (rail.items != null && !rail.items.isEmpty()) {
                if (h.posters == null) {
                    h.posters = new PosterAdapter(item -> openItem(ctx, item), false);
                    h.list.setAdapter(h.posters);
                } else if (h.list.getAdapter() != h.posters) {
                    h.list.setAdapter(h.posters);
                }
                h.posters.setItems(rail.items);
            } else {
                h.list.setAdapter(null);
            }
            h.list.requestLayout();
        }

        @Override
        public void onViewRecycled(@NonNull RecyclerView.ViewHolder holder) {
            if (holder instanceof AdVH) Ads.recycleBanner(((AdVH) holder).slot);
            Motion.ensureVisible(holder.itemView);
            super.onViewRecycled(holder);
        }

        @Override
        public int getItemCount() {
            return (hasHero() ? 1 : 0) + rails.size();
        }

        class HeroVH extends RecyclerView.ViewHolder {
            HeroVH(View v) { super(v); }
        }

        class AdVH extends RecyclerView.ViewHolder {
            final FrameLayout slot;
            AdVH(View v) {
                super(v);
                slot = v.findViewById(R.id.homeAdSlot);
            }
        }

        class VH extends RecyclerView.ViewHolder {
            final TextView title;
            final TextView viewAll;
            final RecyclerView list;
            final HorizontalScrollView chips;
            PosterAdapter posters;

            VH(View v) {
                super(v);
                title = v.findViewById(R.id.tvHomeTitle);
                viewAll = v.findViewById(R.id.tvHomeTitleViewAll);
                list = v.findViewById(R.id.rv_content);
                chips = new HorizontalScrollView(v.getContext());
                chips.setHorizontalScrollBarEnabled(false);
                chips.setLayoutParams(new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            }
        }
    }

    class ShortcutAdapter extends RecyclerView.Adapter<ShortcutAdapter.SVH> {
        private final List<Shortcut> data;

        ShortcutAdapter(List<Shortcut> data) {
            this.data = data == null ? new ArrayList<>() : data;
        }

        @NonNull
        @Override
        public SVH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_home_shortcut, parent, false);
            return new SVH(v);
        }

        @Override
        public void onBindViewHolder(@NonNull SVH h, int position) {
            Shortcut s = data.get(position);
            h.emoji.setText(s.emoji);
            h.name.setText(s.label);
            h.name.setTextColor(s.tint);
            Motion.press(h.itemView);
            h.itemView.setOnClickListener(v -> openShortcut(s));
        }

        @Override
        public int getItemCount() {
            return data.size();
        }

        class SVH extends RecyclerView.ViewHolder {
            final TextView emoji;
            final TextView name;

            SVH(View v) {
                super(v);
                emoji = v.findViewById(R.id.emoji);
                name = v.findViewById(R.id.name);
            }
        }
    }
}
