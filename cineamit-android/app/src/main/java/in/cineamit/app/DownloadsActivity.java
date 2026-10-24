package in.cineamit.app;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.text.InputType;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.fragment.app.FragmentActivity;

import java.io.File;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

import in.cineamit.app.data.DlVault;
import in.cineamit.app.data.Downloads;
import in.cineamit.app.data.Downloads.Item;
import in.cineamit.app.data.GallerySave;
import in.cineamit.app.ui.Motion;
import in.cineamit.app.ui.Ui;

public class DownloadsActivity extends FragmentActivity implements Downloads.Listener {
    private String folder = "All";
    private Runnable afterWrite;

    public static void open(Context ctx) {
        Intent i = new Intent(ctx, DownloadsActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (!(ctx instanceof android.app.Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_downloads);
        Ui.cineHeader(findViewById(android.R.id.content), "Downloads", v -> finish());
        View sc = findViewById(android.R.id.content);
        if (sc instanceof android.view.ViewGroup && ((android.view.ViewGroup) sc).getChildCount() > 0) {
            android.view.ViewGroup root = (android.view.ViewGroup) ((android.view.ViewGroup) sc).getChildAt(0);
            for (int i = 0; i < root.getChildCount(); i++) {
                if (root.getChildAt(i) instanceof androidx.core.widget.NestedScrollView) {
                    Ui.padForIsland(root.getChildAt(i));
                    break;
                }
            }
        }
        Downloads.listen(this);
        DownloadService.askNotify(this);
        Downloads.resumeQueue();
        View reset = findViewById(R.id.dlPinReset);
        if (reset != null) {
            Motion.press(reset);
            reset.setOnClickListener(v -> resetPin());
        }
        paint(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Downloads.resumeQueue();
        paint(false);
    }

    @Override
    protected void onStop() {
        DlVault.lock();
        if (Downloads.FOLDER_PRIVATE.equals(folder)) folder = "All";
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        Downloads.unlisten(this);
        super.onDestroy();
    }

    @Override
    public void onDownloads() {
        if (isFinishing() || isDestroyed()) return;
        paint(false);
    }

    private boolean alive() {
        return !isFinishing() && !isDestroyed();
    }

    private void paint(boolean reloadArt) {
        if (!alive()) return;
        paintFolders();
        List<Item> items = Downloads.inFolder(folder);
        TextView storage = findViewById(R.id.dlStorage);
        if (storage != null) {
            storage.setText("Used  " + Downloads.prettySize(Downloads.bytesUsed())
                    + "   ·   expires in 30 days");
        }
        View reset = findViewById(R.id.dlPinReset);
        if (reset != null) reset.setVisibility(DlVault.hasPin() ? View.VISIBLE : View.GONE);
        LinearLayout list = findViewById(R.id.dlList);
        if (list == null) return;
        TextView empty = findViewById(R.id.dlEmpty);
        if (empty != null) {
            if (Downloads.FOLDER_PRIVATE.equals(folder) && !DlVault.unlocked()) {
                empty.setText("Private folder is locked. Tap the Private chip and enter PIN.");
            } else if (Downloads.FOLDER_PRIVATE.equals(folder)) {
                empty.setText("Private is empty. Long-press an item to move it here.");
            } else {
                empty.setText("No downloads in this folder. Tap Download on Details, or add a folder.");
            }
        }
        Ui.show(empty, items.isEmpty());
        boolean same = list.getChildCount() == items.size();
        if (same) {
            for (int i = 0; i < items.size(); i++) {
                Object tag = list.getChildAt(i).getTag();
                if (tag == null || !items.get(i).key.equals(String.valueOf(tag))) {
                    same = false;
                    break;
                }
            }
        }
        if (!same) {
            list.removeAllViews();
            LayoutInflater inf = LayoutInflater.from(this);
            for (Item it : items) {
                View row = inf.inflate(R.layout.item_download, list, false);
                row.setTag(it.key);
                bindRow(row, it, true);
                list.addView(row);
            }
        } else {
            for (int i = 0; i < items.size(); i++) {
                bindRow(list.getChildAt(i), items.get(i), reloadArt);
            }
        }
    }

    private void bindRow(View row, Item it, boolean loadArt) {
        ((TextView) row.findViewById(R.id.title)).setText(it.title);
        ((TextView) row.findViewById(R.id.meta)).setText(badge(it));
        ((TextView) row.findViewById(R.id.sub)).setText(sub(it));
        ProgressBar bar = row.findViewById(R.id.bar);
        View dim = row.findViewById(R.id.dim);
        boolean run = Downloads.ST_RUN.equals(it.status) || Downloads.ST_QUEUED.equals(it.status);
        bar.setVisibility(run ? View.VISIBLE : View.GONE);
        dim.setVisibility(run ? View.VISIBLE : View.GONE);
        if (it.total > 0) bar.setProgress(Math.max(0, it.progress));
        else bar.setProgress(run ? 15 : 0);
        if (loadArt) {
            ImageView poster = row.findViewById(R.id.poster);
            File art = Downloads.artFile(it);
            if (art.isFile()) Images.load(poster, art.toURI().toString(), R.drawable.place_holder_show);
            else Images.load(poster, ApiImg(it.poster), R.drawable.place_holder_show);
        }
        View lock = row.findViewById(R.id.lock);
        if (lock != null) lock.setVisibility(it.priv ? View.VISIBLE : View.GONE);
        View gal = row.findViewById(R.id.btnGallery);
        if (gal != null) {
            boolean showGal = Downloads.canPlayOffline(it);
            gal.setVisibility(showGal ? View.VISIBLE : View.GONE);
            gal.setAlpha(Downloads.inGallery(it) ? 0.45f : 1f);
            gal.setOnClickListener(v -> saveGallery(it));
        }
        Motion.press(row);
        row.setOnClickListener(v -> play(it));
        row.setOnLongClickListener(v -> {
            moveToFolder(it);
            return true;
        });
        row.findViewById(R.id.btnDelete).setOnClickListener(v -> confirmDelete(it));
    }

    private void paintFolders() {
        LinearLayout row = findViewById(R.id.dlFolders);
        if (row == null) return;
        row.removeAllViews();
        row.addView(Ui.chip(this, "All", "All".equals(folder), v -> showFolder("All")));
        for (String f : Downloads.folders()) {
            row.addView(Ui.chip(this, f, f.equals(folder), v -> showFolder(f)));
        }
        boolean privOn = Downloads.FOLDER_PRIVATE.equals(folder);
        TextView priv = Ui.chip(this, DlVault.unlocked() ? "Private" : "Private 🔒", privOn, v -> openPrivate());
        priv.setOnLongClickListener(v -> {
            privateMenu();
            return true;
        });
        row.addView(priv);
        row.addView(Ui.chip(this, "+ Folder", false, v -> addFolder()));
    }

    private void addFolder() {
        EditText input = new EditText(this);
        input.setHint("Movies, Series, Anime…");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        input.setTextColor(0xFFF4F1EA);
        input.setHintTextColor(0xFF9CA3AF);
        new AlertDialog.Builder(this)
                .setTitle("Add folder")
                .setMessage("e.g. Movies, Series, Anime — or your own name.")
                .setView(input)
                .setPositiveButton("Add", (d, w) -> {
                    String name = input.getText() == null ? "" : input.getText().toString();
                    String clean = name.trim();
                    if (Downloads.FOLDER_PRIVATE.equalsIgnoreCase(clean)) {
                        openPrivate();
                        return;
                    }
                    Downloads.addFolder(name);
                    if (!clean.isEmpty()) folder = clean.length() > 24 ? clean.substring(0, 24).trim() : clean;
                    paint(false);
                })
                .setNeutralButton("Movies", (d, w) -> { Downloads.addFolder("Movies"); folder = "Movies"; paint(false); })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void showFolder(String f) {
        if (Downloads.FOLDER_PRIVATE.equals(folder) && !Downloads.FOLDER_PRIVATE.equals(f)) DlVault.lock();
        folder = f;
        paint(false);
    }

    private void openPrivate() {
        DlVault.ensure(this, () -> {
            folder = Downloads.FOLDER_PRIVATE;
            paint(true);
        });
    }

    private void privateMenu() {
        new AlertDialog.Builder(this)
                .setTitle("Private")
                .setItems(new CharSequence[]{"Open", "Lock now", "Change PIN", "Reset PIN"}, (d, which) -> {
                    if (which == 0) openPrivate();
                    else if (which == 1) {
                        DlVault.lock();
                        if (Downloads.FOLDER_PRIVATE.equals(folder)) folder = "All";
                        paint(false);
                    } else if (which == 2) {
                        DlVault.change(this, () -> Toast.makeText(this, "PIN changed", Toast.LENGTH_SHORT).show());
                    } else {
                        resetPin();
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void resetPin() {
        DlVault.forgot(this, () -> {
            folder = "All";
            paint(true);
        });
    }

    private void saveGallery(Item it) {
        if (it == null) return;
        if (it.priv) {
            new AlertDialog.Builder(this)
                    .setTitle("Save to Gallery")
                    .setMessage("The private file will appear in Gallery. Continue?")
                    .setPositiveButton("Save", (d, w) -> doSaveGallery(it))
                    .setNegativeButton("Cancel", null)
                    .show();
            return;
        }
        doSaveGallery(it);
    }

    private void doSaveGallery(Item it) {
        withWrite(() -> Io.run(this, () -> Downloads.saveToGallery(it), msg -> {
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
            paint(false);
        }, e -> Toast.makeText(this, "Gallery save fail", Toast.LENGTH_SHORT).show()));
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

    private void moveToFolder(Item it) {
        List<String> names = Downloads.folders();
        names.add(Downloads.FOLDER_PRIVATE);
        String[] opts = names.toArray(new String[0]);
        new AlertDialog.Builder(this)
                .setTitle("Move to folder")
                .setItems(opts, (d, which) -> {
                    String dest = opts[which];
                    if (Downloads.FOLDER_PRIVATE.equals(dest)) {
                        DlVault.ensure(this, () -> {
                            Downloads.setPrivate(it, true);
                            paint(true);
                        });
                    } else {
                        Downloads.setFolder(it, dest);
                        paint(true);
                    }
                })
                .setNeutralButton("New folder", (d, w) -> addFolderThenMove(it))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void addFolderThenMove(Item it) {
        EditText input = new EditText(this);
        input.setHint("Folder name");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        new AlertDialog.Builder(this)
                .setTitle("New folder")
                .setView(input)
                .setPositiveButton("Move", (d, w) -> {
                    String name = input.getText() == null ? "" : input.getText().toString();
                    if (Downloads.FOLDER_PRIVATE.equalsIgnoreCase(name.trim())) {
                        DlVault.ensure(this, () -> {
                            Downloads.setPrivate(it, true);
                            folder = Downloads.FOLDER_PRIVATE;
                            paint(true);
                        });
                        return;
                    }
                    Downloads.addFolder(name);
                    Downloads.setFolder(it, name);
                    folder = (it.folder == null || it.folder.isEmpty()) ? "All" : it.folder;
                    paint(true);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private String ApiImg(String poster) {
        return in.cineamit.app.data.Api.img(in.cineamit.app.data.Models.Session.imageBase, poster, "w342");
    }

    private String badge(Item it) {
        if (Downloads.ST_WIFI.equals(it.status)) return "Waiting for Wi‑Fi";
        if (Downloads.ST_RUN.equals(it.status)) {
            if (it.total > 0) return "Downloading  " + it.progress + "%";
            return "Downloading  " + Downloads.prettySize(Math.max(0, it.bytes));
        }
        if (Downloads.ST_QUEUED.equals(it.status)) return "Queued";
        if (Downloads.ST_FAIL.equals(it.status)) return Downloads.errLabel(it) + "  ·  tap to retry";
        if (Downloads.canPlayOffline(it)) return "Offline  ·  " + qLabel(it.quality);
        return "Failed";
    }

    private String sub(Item it) {
        String q = qLabel(it.quality);
        String ep = ("tv".equals(it.type) || "anime".equals(it.type))
                ? String.format(Locale.US, "S%d E%d  ·  ", it.s, it.e) : "";
        String left = "";
        long ms = it.expires - System.currentTimeMillis();
        if (ms > 0) {
            long d = TimeUnit.MILLISECONDS.toDays(ms);
            left = d <= 0 ? "Expires today" : ("Expires in " + d + "d");
        }
        String size = it.bytes > 0 ? Downloads.prettySize(it.bytes) : "";
        String fold = it.priv ? Downloads.FOLDER_PRIVATE
                : ((it.folder == null || it.folder.isEmpty()) ? Downloads.defaultFolder(it.type) : it.folder);
        String gal = Downloads.inGallery(it) ? "  ·  Gallery" : "";
        String bit = ep + fold + "  ·  " + q;
        if (!size.isEmpty()) bit += "  ·  " + size;
        if (!left.isEmpty()) bit += "  ·  " + left;
        bit += gal;
        return bit;
    }

    private static String qLabel(String q) {
        if (Downloads.Q_SAVER.equals(q)) return "Data Saver";
        if (Downloads.Q_BEST.equals(q)) return "Best";
        return "High";
    }

    private void play(Item it) {
        if (Downloads.ST_RUN.equals(it.status) || Downloads.ST_QUEUED.equals(it.status)
                || Downloads.ST_WIFI.equals(it.status)) {
            return;
        }
        if (it.priv && !DlVault.unlocked()) {
            DlVault.ensure(this, () -> play(it));
            return;
        }
        if (Downloads.canPlayOffline(it)) {
            PlayerActivity.openLocal(this, it.path, it.title);
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle(it.title)
                .setMessage(Downloads.errLabel(it) + "\nRetry download, or watch online?")
                .setPositiveButton("Retry", (d, w) -> Downloads.retry(it))
                .setNeutralButton("Watch", (d, w) ->
                        WatchActivity.open(this, it.type, it.id, it.title, it.s, it.e))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void confirmDelete(Item it) {
        new AlertDialog.Builder(this)
                .setTitle("Remove download")
                .setMessage("Delete “" + it.title + "” from this device?")
                .setPositiveButton("Delete", (d, w) -> Downloads.delete(it))
                .setNegativeButton("Cancel", null)
                .show();
    }
}
