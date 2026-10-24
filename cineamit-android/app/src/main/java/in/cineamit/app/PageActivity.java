package in.cineamit.app;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;

import androidx.fragment.app.FragmentActivity;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.MediaItem;
import in.cineamit.app.ui.LoadMoreFooter;
import in.cineamit.app.ui.Motion;
import in.cineamit.app.ui.PosterAdapter;
import in.cineamit.app.ui.Ui;

public class PageActivity extends FragmentActivity {
    private static final String[][] HUB = {
            {"actors", "Actors"},
            {"albums", "Albums"},
            {"reels", "Reels"},
            {"mood", "Mood"},
            {"blog", "Blog"},
            {"surprise", "Surprise me"},
            {"history", "History"},
            {"playlists", "Playlists"},
            {"notifications", "Notifications"},
            {"cine_match", "Cine Match"},
            {"wrapped", "Cine Wrapped"},
            {"help", "Help"},
            {"faq", "FAQ"},
            {"contact", "Contact"},
            {"about", "About"},
            {"privacy", "Privacy"},
            {"terms", "Terms"},
            {"dmca", "DMCA"},
            {"legal", "Legal"},
            {"download", "Downloads"},
            {"forgot", "Forgot password"},
            {"totp", "Two-Factor (2FA)"},
    };

    private String kind = "hub";
    private String pageId = "";
    private PosterAdapter posters;
    private int forgotStep;
    private boolean busy;
    private boolean loginGate;
    private int gridPage = 1;
    private int gridTotal = 1;
    private boolean gridLoading;
    private int gridGen;
    private String matchCode = "";
    private LoadMoreFooter moreFoot;

    public static void open(Context ctx, String kind) {
        open(ctx, kind, "");
    }

    public static void open(Context ctx, String kind, String id) {
        Intent i = new Intent(ctx, PageActivity.class).putExtra("kind", kind).putExtra("id", id == null ? "" : id);
        if (!(ctx instanceof android.app.Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_page);
        kind = String.valueOf(getIntent().getStringExtra("kind"));
        if (kind == null || kind.isEmpty() || "null".equals(kind)) kind = "hub";
        pageId = String.valueOf(getIntent().getStringExtra("id"));
        if (pageId == null || "null".equals(pageId)) pageId = "";
        Ui.cineHeader(findViewById(android.R.id.content), titleFor(kind), v -> finish());
        Motion.page(findViewById(android.R.id.content));
        Ui.padForBanner(findViewById(R.id.list));
        RecyclerView list = findViewById(R.id.list);
        posters = new PosterAdapter(item -> {
            if ("collection".equals(item.media_type) || "albums".equals(kind)) {
                open(this, "album", String.valueOf(item.id));
            } else {
                DetailsActivity.open(this, item.media_type, item.id);
            }
        }, true);
        if ("history".equals(kind)) {
            posters.setOnRemove(this::confirmHistoryRemove);
        }
        findViewById(R.id.btnAction).setOnClickListener(v -> onAction());
        findViewById(R.id.btnSecondary).setOnClickListener(v -> onSecondary());
        Motion.press(findViewById(R.id.btnAction));
        moreFoot = new LoadMoreFooter(this::loadMoreGrid);
        load();
    }

    private static String titleFor(String k) {
        for (String[] row : HUB) if (row[0].equals(k)) return row[1];
        if ("album".equals(k)) return "Album";
        if ("playlist".equals(k)) return "Playlist";
        if ("hub".equals(k)) return "Pages";
        return k;
    }

    private void load() {
        if ("hub".equals(kind)) {
            showHub();
            return;
        }
        if ("mood".equals(kind)) {
            showMood();
            return;
        }
        if ("actors".equals(kind)) {
            loadGrid(1, true);
            return;
        }
        progress(true);
        if ("albums".equals(kind)) {
            showForm(true, false, false, "Search collections", "", "", "Search");
        }
        final String albumQ = "albums".equals(kind)
                ? ((EditText) findViewById(R.id.field1)).getText().toString().trim()
                : "";
        Io.run(this, () -> {
            if ("albums".equals(kind)) {
                return albumQ.isEmpty() ? Api.page("albums") : Api.pageQuery("albums", albumQ);
            }
            if (pageId != null && !pageId.isEmpty()) return Api.page(kind, pageId);
            return Api.page(kind);
        }, this::bind, this::fail);
    }

    private void loadGrid(int p, boolean reset) {
        if (gridLoading && !reset) return;
        final int my = ++gridGen;
        gridLoading = true;
        if (reset) {
            progress(true);
            if (moreFoot != null) moreFoot.hide();
        } else if (moreFoot != null) moreFoot.loading();
        Io.run(this, () -> Api.page(kind, p), json -> {
            if (my != gridGen) return;
            gridLoading = false;
            progress(false);
            Api.applyMeta(json);
            if ("login_required".equals(json.optString("error"))) {
                needLogin();
                return;
            }
            List<MediaItem> items = Api.parseItems(json.optJSONArray("items"));
            gridPage = p;
            int reported = json.optInt("total_pages", 0);
            if (reported > 0) gridTotal = reported;
            else gridTotal = items.size() >= 15 ? p + 1 : p;
            if (reset) showGrid(items, false);
            else {
                int added = posters.addItems(items);
                if (items.isEmpty() || added == 0) gridTotal = p;
            }
            paintMore();
            if (posters.getItemCount() == 0) status("Nothing found.");
        }, e -> {
            if (my != gridGen) return;
            gridLoading = false;
            fail(e);
            paintMore();
        });
    }

    private void paintMore() {
        if (moreFoot == null) return;
        boolean show = "actors".equals(kind) && gridPage < gridTotal && posters.getItemCount() > 0;
        if (show) moreFoot.idle(true);
        else moreFoot.hide();
    }

    private void loadMoreGrid() {
        if (!"actors".equals(kind) || gridLoading || gridPage >= gridTotal) {
            if (moreFoot != null && gridPage >= gridTotal) moreFoot.hide();
            return;
        }
        loadGrid(gridPage + 1, false);
    }

    private void bind(JSONObject json) {
        progress(false);
        loginGate = false;
        Api.applyMeta(json);
        if ("login_required".equals(json.optString("error"))) {
            needLogin();
            return;
        }
        if ("kids_restricted".equals(json.optString("error"))) {
            status("This page is not available in Kids Mode.");
            return;
        }
        if (!json.optBoolean("ok", json.optString("error").isEmpty()) && !json.optString("error").isEmpty()) {
            status(errMsg(json.optString("error")));
            return;
        }
        String title = json.optString("title", titleFor(kind));
        if (!title.isEmpty()) {
            TextView t = findViewById(R.id.browseTitle);
            if (t != null) t.setText(title);
        }
        if ("surprise".equals(kind)) {
            JSONObject item = json.optJSONObject("item");
            if (item != null) {
                DetailsActivity.open(this, item.optString("media_type", "movie"), item.optLong("id"));
                finish();
                return;
            }
        }
        List<MediaItem> items = Api.parseItems(json.optJSONArray("items"));
        JSONArray rows = json.optJSONArray("rows");
        String body = json.optString("body");
        boolean hasRows = rows != null && rows.length() > 0;
        boolean hasItems = !items.isEmpty();

        if ("contact".equals(kind)) {
            showArticle(body);
            showForm(true, true, true, "Your name", "Email", "Message", "Send");
            return;
        }
        if ("forgot".equals(kind)) {
            showForgot(0, body);
            return;
        }
        if ("cine_match".equals(kind)) {
            matchCode = json.optString("match_code");
            String intro = body;
            if (!matchCode.isEmpty()) intro = (intro.isEmpty() ? "" : intro + "\n\n") + "Your code: " + matchCode;
            String friend = json.optString("friend");
            if (!friend.isEmpty()) intro = intro + "\nMatched with " + friend + ".";
            showArticle(intro);
            showForm(true, false, false, "Friend match code", "", "", "Compare");
            Ui.show(findViewById(R.id.btnSecondary), !matchCode.isEmpty());
            ((TextView) findViewById(R.id.btnSecondary)).setText("Copy match link");
            if (hasItems) showGrid(items, true);
            return;
        }
        if ("playlists".equals(kind)) {
            showArticle(hasRows ? body : (body.isEmpty() ? "Apni collection banao." : body));
            showForm(true, false, false, "New playlist name", "", "", "Create");
            if (hasRows) showRows(rows, true);
            return;
        }
        if ("wrapped".equals(kind)) {
            int total = json.optInt("total", items.size());
            int movies = json.optInt("movies", 0);
            int tv = json.optInt("tv", 0);
            String stats = total > 0
                    ? ("Total titles: " + total + "\nMovies: " + movies + "\nSeries: " + tv)
                    : (body.isEmpty() ? "History is empty." : body);
            showArticle(stats);
            if (hasItems) showGrid(items, true);
            return;
        }
        if ("albums".equals(kind)) {
            showArticle(items.isEmpty() ? "Search a collection — e.g. Marvel, Fast, Harry Potter." : "");
            showForm(true, false, false, "Search collections", "", "", "Search");
            if (hasItems) showGrid(items, true);
            else if (!((EditText) findViewById(R.id.field1)).getText().toString().trim().isEmpty()) {
                status("No albums.");
            }
            return;
        }
        if ("history".equals(kind)) {
            showArticle(hasItems ? body : (body.isEmpty() ? "Nothing found." : body));
            if (hasItems) showGrid(items, true);
            Ui.show(findViewById(R.id.btnSecondary), hasItems);
            ((TextView) findViewById(R.id.btnSecondary)).setText("Clear history");
            return;
        }
        if (hasRows) {
            showRows(rows);
            return;
        }
        if (hasItems) {
            showGrid(items, false);
            return;
        }
        if ("wrapped".equals(kind) || "reels".equals(kind) || "actors".equals(kind)
                || "playlists".equals(kind) || "notifications".equals(kind) || "blog".equals(kind) || "help".equals(kind)) {
            showArticle(body.isEmpty() ? "Nothing found." : body);
            if ("notifications".equals(kind)) {
                Ui.show(findViewById(R.id.btnSecondary), true);
                ((TextView) findViewById(R.id.btnSecondary)).setText("Clear all");
            }
            return;
        }
        showArticle(body);
    }

    private void showHub() {
        progress(false);
        List<String> names = new ArrayList<>();
        for (String[] row : HUB) names.add(row[1]);
        RecyclerView list = findViewById(R.id.list);
        list.setVisibility(View.VISIBLE);
        findViewById(R.id.articleScroll).setVisibility(View.GONE);
        list.setLayoutManager(new LinearLayoutManager(this));
        list.setAdapter(new ListActivity.TextAdapter(names, i -> {
            String k = HUB[i][0];
            if ("reels".equals(k)) ReelsActivity.open(this);
            else if ("forgot".equals(k)) open(this, "forgot");
            else open(this, k);
        }));
    }

    private void showArticle(String body) {
        findViewById(R.id.articleScroll).setVisibility(View.VISIBLE);
        findViewById(R.id.list).setVisibility(View.GONE);
        findViewById(R.id.status).setVisibility(View.GONE);
        TextView t = findViewById(R.id.body);
        t.setText(body == null ? "" : body);
        t.setVisibility(body == null || body.isEmpty() ? View.GONE : View.VISIBLE);
        RecyclerView inner = findViewById(R.id.innerList);
        if (inner != null) inner.setVisibility(View.GONE);
        Ui.show(findViewById(R.id.field1), false);
        Ui.show(findViewById(R.id.field2), false);
        Ui.show(findViewById(R.id.field3), false);
        Ui.show(findViewById(R.id.btnAction), false);
        Ui.show(findViewById(R.id.btnSecondary), false);
        if (moreFoot != null) moreFoot.hide();
        Motion.rise(findViewById(R.id.articleCard), 40);
    }

    private void showForm(boolean f1, boolean f2, boolean f3, String h1, String h2, String h3, String action) {
        findViewById(R.id.articleScroll).setVisibility(View.VISIBLE);
        Ui.show(findViewById(R.id.field1), f1);
        Ui.show(findViewById(R.id.field2), f2);
        Ui.show(findViewById(R.id.field3), f3);
        if (f1) ((EditText) findViewById(R.id.field1)).setHint(h1);
        if (f2) ((EditText) findViewById(R.id.field2)).setHint(h2);
        if (f3) ((EditText) findViewById(R.id.field3)).setHint(h3);
        Ui.show(findViewById(R.id.btnAction), action != null && !action.isEmpty());
        if (action != null) ((TextView) findViewById(R.id.btnAction)).setText(action);
    }

    private void showForgot(int step, String body) {
        forgotStep = step;
        showArticle(body == null || body.isEmpty()
                ? (step == 0 ? "Enter your email. An OTP will be sent." : (step == 1 ? "Enter the 6-digit code." : "Set a new password."))
                : body);
        if (step == 0) showForm(true, false, false, "Email", "", "", "Send code");
        else if (step == 1) showForm(true, true, false, "Email", "6-digit code", "", "Verify");
        else showForm(false, true, true, "", "New password", "Confirm password", "Update password");
        if (step == 2) {
            ((EditText) findViewById(R.id.field2)).setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
            ((EditText) findViewById(R.id.field3)).setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
            ((EditText) findViewById(R.id.field3)).setMinLines(1);
        }
    }

    private void showGrid(List<MediaItem> items, boolean keepForm) {
        findViewById(R.id.status).setVisibility(View.GONE);
        if (keepForm) {
            findViewById(R.id.articleScroll).setVisibility(View.VISIBLE);
            findViewById(R.id.list).setVisibility(View.GONE);
            RecyclerView inner = findViewById(R.id.innerList);
            inner.setVisibility(View.VISIBLE);
            inner.setLayoutManager(new GridLayoutManager(this, Ui.posterSpan(this)) {
                @Override public boolean canScrollVertically() { return false; }
            });
            inner.setAdapter(posters);
            posters.setItems(items);
            return;
        }
        RecyclerView list = findViewById(R.id.list);
        list.setVisibility(View.VISIBLE);
        findViewById(R.id.articleScroll).setVisibility(View.GONE);
        RecyclerView inner = findViewById(R.id.innerList);
        if (inner != null) inner.setVisibility(View.GONE);
        int span = Ui.posterSpan(this);
        GridLayoutManager lm = new GridLayoutManager(this, span);
        list.setLayoutManager(lm);
        posters.setItems(items);
        moreFoot = new LoadMoreFooter(this::loadMoreGrid);
        LoadMoreFooter.attach(list, posters, moreFoot, span);
        paintMore();
    }

    private void showMood() {
        progress(false);
        findViewById(R.id.status).setVisibility(View.GONE);
        boolean kids = in.cineamit.app.data.Models.Session.user != null
                && in.cineamit.app.data.Models.Session.user.is_kids;
        final String[][] moods = kids
                ? new String[][]{
                    {"35,16", "Chill · Laugh it off"},
                    {"10751", "Family"},
                }
                : new String[][]{
                    {"35", "Chill · Laugh it off"},
                    {"28", "Thrill · Adrenaline"},
                    {"27", "Scary · Nightmares"},
                    {"878", "Mind-bending · Sci-Fi"},
                    {"10749", "Romantic Night"},
                };
        showArticle("Pick a mood — matching titles will appear.");
        List<String> names = new ArrayList<>();
        for (String[] m : moods) names.add(m[1]);
        findViewById(R.id.list).setVisibility(View.GONE);
        findViewById(R.id.articleScroll).setVisibility(View.VISIBLE);
        RecyclerView inner = findViewById(R.id.innerList);
        inner.setVisibility(View.VISIBLE);
        inner.setLayoutManager(new LinearLayoutManager(this) {
            @Override public boolean canScrollVertically() { return false; }
        });
        inner.setAdapter(new ListActivity.TextAdapter(names, i ->
                BrowseActivity.openGenre(this, "movie", moods[i][1], moods[i][0])));
    }

    private void showRows(JSONArray rows) {
        showRows(rows, false);
    }

    private void showRows(JSONArray rows, boolean keepForm) {
        List<String> names = new ArrayList<>();
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject o = rows.optJSONObject(i);
            if (o == null) continue;
            String title = o.optString("title");
            String body = o.optString("body");
            names.add(body.isEmpty() ? title : title + "  ·  " + body);
            ids.add(o.optString("id"));
        }
        String nextKind = "playlists".equals(kind) ? "playlist" : kind;
        ListActivity.TextAdapter adapter = new ListActivity.TextAdapter(names, i -> {
            if ("notifications".equals(kind)) return;
            open(this, nextKind, ids.get(i));
        });
        findViewById(R.id.status).setVisibility(View.GONE);
        if (keepForm) {
            findViewById(R.id.articleScroll).setVisibility(View.VISIBLE);
            findViewById(R.id.list).setVisibility(View.GONE);
            RecyclerView inner = findViewById(R.id.innerList);
            inner.setVisibility(View.VISIBLE);
            inner.setLayoutManager(new LinearLayoutManager(this) {
                @Override public boolean canScrollVertically() { return false; }
            });
            inner.setAdapter(adapter);
            return;
        }
        RecyclerView list = findViewById(R.id.list);
        list.setVisibility(View.VISIBLE);
        findViewById(R.id.articleScroll).setVisibility(View.GONE);
        list.setLayoutManager(new LinearLayoutManager(this));
        list.setAdapter(adapter);
    }

    private void onAction() {
        if (busy) return;
        if (loginGate) {
            LoginActivity.open(this);
            return;
        }
        if ("contact".equals(kind)) {
            HashMap<String, String> f = new HashMap<>();
            f.put("name", text(R.id.field1));
            f.put("email", text(R.id.field2));
            f.put("message", text(R.id.field3));
            post("contact", f, json -> {
                if (json.optBoolean("ok")) status(json.optString("message", "Sent."));
                else status(errMsg(json.optString("error")));
            });
            return;
        }
        if ("forgot".equals(kind) || forgotStep > 0) {
            HashMap<String, String> f = new HashMap<>();
            if (forgotStep == 0) {
                f.put("email", text(R.id.field1));
                post("forgot", f, json -> {
                    if (json.optBoolean("ok")) showForgot(1, json.optString("message"));
                    else status(errMsg(json.optString("error")));
                });
            } else if (forgotStep == 1) {
                f.put("email", text(R.id.field1));
                f.put("otp", text(R.id.field2));
                post("forgot_verify", f, json -> {
                    if (json.optBoolean("ok")) showForgot(2, json.optString("message"));
                    else status(errMsg(json.optString("error")));
                });
            } else {
                f.put("password", text(R.id.field2));
                f.put("confirm", text(R.id.field3));
                post("forgot_reset", f, json -> {
                    if (json.optBoolean("ok")) {
                        status(json.optString("message", "Password updated."));
                        startActivity(new Intent(this, LoginActivity.class)
                                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
                        finish();
                    } else status(errMsg(json.optString("error")));
                });
            }
            return;
        }
        if ("cine_match".equals(kind)) {
            HashMap<String, String> f = new HashMap<>();
            f.put("code", text(R.id.field1));
            post("cine_match", f, this::bind);
            return;
        }
        if ("playlists".equals(kind)) {
            HashMap<String, String> f = new HashMap<>();
            f.put("name", text(R.id.field1));
            post("playlists", f, this::bind);
            return;
        }
        if ("albums".equals(kind)) {
            load();
        }
    }

    private void onSecondary() {
        if ("history".equals(kind)) {
            new AlertDialog.Builder(this)
                    .setTitle("Clear history")
                    .setMessage("All watch history will be deleted.")
                    .setPositiveButton("Clear all", (d, w) -> {
                        HashMap<String, String> f = new HashMap<>();
                        f.put("action", "clear");
                        post("history", f, this::bind);
                    })
                    .setNegativeButton("Cancel", null)
                    .show();
        } else if ("notifications".equals(kind)) {
            post("notifications", new HashMap<>(), this::bind);
        } else if ("cine_match".equals(kind) && matchCode != null && !matchCode.isEmpty()) {
            String link = CineAmitApp.baseUrl().replaceAll("/+$", "") + "/cine-match/compare?code=" + matchCode;
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(android.content.ClipData.newPlainText("Cine Match", link));
            android.widget.Toast.makeText(this, "Match link copied", android.widget.Toast.LENGTH_SHORT).show();
        }
    }

    private void confirmHistoryRemove(MediaItem item) {
        if (item == null) return;
        new AlertDialog.Builder(this)
                .setTitle("Remove")
                .setMessage("Remove “" + item.title + "” from history?")
                .setPositiveButton("Remove", (d, w) -> {
                    HashMap<String, String> f = new HashMap<>();
                    f.put("action", "remove");
                    f.put("tmdb_id", String.valueOf(item.id));
                    f.put("id", String.valueOf(item.id));
                    f.put("media_type", item.media_type == null ? "movie" : item.media_type);
                    f.put("type", item.media_type == null ? "movie" : item.media_type);
                    post("history", f, this::bind);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void post(String k, HashMap<String, String> fields, Io.Ok<JSONObject> ok) {
        busy = true;
        progress(true);
        Io.run(this, () -> Api.pagePost(k, fields), json -> {
            busy = false;
            progress(false);
            ok.accept(json);
        }, e -> {
            busy = false;
            fail(e);
        });
    }

    private String text(int id) {
        return ((EditText) findViewById(id)).getText().toString().trim();
    }

    private void needLogin() {
        loginGate = true;
        status("Please sign in to open this page.");
        showArticle("An account is required for watchlist, history, playlists, Live TV, and Cine Match.");
        showForm(false, false, false, "", "", "", "Sign in");
    }

    private void progress(boolean on) {
        findViewById(R.id.progress).setVisibility(on ? View.VISIBLE : View.GONE);
        if (on) findViewById(R.id.status).setVisibility(View.GONE);
    }

    private void status(String m) {
        progress(false);
        TextView t = findViewById(R.id.status);
        t.setText(m);
        t.setVisibility(View.VISIBLE);
    }

    private void fail(Exception e) {
        progress(false);
        status(CineAmitApp.friendlyNetError(e));
    }

    private String errMsg(String err) {
        switch (err) {
            case "login_required": return "Please sign in.";
            case "kids_restricted": return "Not available in Kids Mode.";
            case "throttled": return "Too many attempts. Wait a bit.";
            case "bad_email": return "Enter a valid email.";
            case "bad_otp":
            case "totp_invalid": return "Wrong or expired code.";
            case "totp_expired":
            case "start_over": return "Session expired. Send the email again.";
            case "weak_password": return "Password 8+ chars, letter + number.";
            case "mismatch": return "Passwords do not match.";
            case "invalid_code": return "Invalid match code.";
            case "not_found": return "Not found.";
            default: return err == null || err.isEmpty() ? "Failed" : err;
        }
    }
}
