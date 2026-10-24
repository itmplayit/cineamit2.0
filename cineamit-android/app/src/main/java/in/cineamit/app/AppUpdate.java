package in.cineamit.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import in.cineamit.app.data.Api;
import in.cineamit.app.ui.Motion;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

public final class AppUpdate {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static boolean sessionShown;
    private static Dialog open;
    private static Call active;

    private AppUpdate() {}

    public static void checkLaunch(Activity a, JSONObject bootstrap) {
        if (a == null) return;
        JSONObject u = bootstrap != null ? bootstrap.optJSONObject("update") : null;
        if (u != null) {
            maybeShow(a, u, false);
            return;
        }
        Io.run(a, Api::appUpdate, json -> maybeShow(a, json, false), e -> {});
    }

    public static void checkNow(Activity a) {
        if (a == null) return;
        Toast.makeText(a, "Checking…", Toast.LENGTH_SHORT).show();
        Io.run(a, Api::appUpdate, json -> maybeShow(a, json, true), e ->
                Toast.makeText(a, CineAmitApp.friendlyNetError(e), Toast.LENGTH_SHORT).show());
    }

    private static void maybeShow(Activity a, JSONObject raw, boolean manual) {
        if (!Io.alive(a) || raw == null) return;
        JSONObject u = raw.optJSONObject("update");
        if (u == null) u = raw;
        String ver = u.optString("version", "").trim();
        if (ver.isEmpty()) {
            if (manual) toast(a, "App is up to date (" + BuildConfig.VERSION_NAME + ")");
            return;
        }
        if (cmp(ver, BuildConfig.VERSION_NAME) <= 0) {
            if (manual) toast(a, "App is up to date (" + BuildConfig.VERSION_NAME + ")");
            return;
        }
        if (!u.optBoolean("enabled",true) || !u.optBoolean("update_ready",false)) {
            if (manual) toast(a,"Update APK is not ready yet. Please contact support.");
            return;
        }
        String checkedUrl=u.optString("update_download_url",u.optString("download_url","")).trim();
        try {UpdateVerifier.trustedUrl(CineAmitApp.baseUrl(),checkedUrl);UpdateVerifier.checksum(u.optString("sha256",""));}
        catch (Exception invalid) {if (manual) toast(a,"Update metadata is incomplete. Please contact support.");return;}
        boolean force = u.optBoolean("force", false);
        if (!force && !manual) {
            String skip = CineAmitApp.prefs().getString("skip_update_ver", "");
            if (ver.equals(skip) || sessionShown) return;
        }
        String url = checkedUrl;
        boolean ready = u.optBoolean("update_ready", false) || u.optBoolean("ready", false) || !url.isEmpty();
        if (!ready && url.isEmpty()) {
            if (manual) toast(a, "Update APK is not ready yet");
            if (!force) return;
        }
        sessionShown = true;
        show(a, u, ver, force, url.isEmpty() ? "" : Api.abs(url));
    }

    private static void show(Activity a, JSONObject u, String ver, boolean force, String url) {
        if (open != null && open.isShowing()) {
            try { open.dismiss(); } catch (Exception ignored) {}
        }
        Dialog d = new Dialog(a, android.R.style.Theme_Translucent_NoTitleBar);
        d.setContentView(R.layout.dialog_update);
        d.setCancelable(!force);
        d.setCanceledOnTouchOutside(!force);
        Window w = d.getWindow();
        if (w != null) {
            w.setGravity(Gravity.CENTER);
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            w.setDimAmount(0.62f);
            w.setWindowAnimations(R.style.CineSheetAnim);
        }
        TextView title = d.findViewById(R.id.updTitle);
        TextView verTv = d.findViewById(R.id.updVer);
        TextView notes = d.findViewById(R.id.updNotes);
        TextView later = d.findViewById(R.id.updLater);
        TextView now = d.findViewById(R.id.updNow);
        View progressRow = d.findViewById(R.id.updProgressRow);
        ProgressBar bar = d.findViewById(R.id.updBar);
        TextView pct = d.findViewById(R.id.updPct);
        if (title != null) title.setText(force ? "Update required" : "Update available");
        String size = u.optString("size_label", "").trim();
        if (verTv != null) {
            verTv.setText("v" + BuildConfig.VERSION_NAME + "  →  v" + ver
                    + (size.isEmpty() ? "" : "  ·  " + size));
        }
        String n = u.optString("notes", "").trim();
        if (notes != null) {
            notes.setText(n.isEmpty() ? "Install the new version." : n);
        }
        if (later != null) {
            later.setVisibility(force ? View.GONE : View.VISIBLE);
            Motion.press(later);
            later.setOnClickListener(v -> {
                CineAmitApp.prefs().edit().putString("skip_update_ver", ver).apply();
                cancelDl();
                d.dismiss();
            });
        }
        if (now != null) {
            now.setBackgroundResource(R.drawable.dlg_btn_purple);
            Motion.press(now);
            now.setOnClickListener(v -> startDownload(a, d, now, later, progressRow, bar, pct, url, u.optString("sha256", ""), ver));
        }
        open = d;
        d.setOnDismissListener(di -> {
            if (open == d) open = null;
        });
        try { d.show(); } catch (Exception ignored) {}
    }

    private static void startDownload(Activity a, Dialog d, TextView now, TextView later,
                                      View progressRow, ProgressBar bar, TextView pct,
                                      String url, String sha, String version) {
        if (url == null || url.isEmpty() || url.equals(CineAmitApp.baseUrl())) {
            try {
                String page = Api.abs("/app");
                if (!WebSecurity.navigationAllowed(page)) throw new java.io.IOException("HTTPS required.");
                a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(page)));
            } catch (Exception e) {
                toast(a, "Download link not found");
            }
            return;
        }
        final String trusted;
        final String expectedSha;
        try {
            trusted = UpdateVerifier.trustedUrl(CineAmitApp.baseUrl(), url).toString();
            expectedSha = UpdateVerifier.checksum(sha);
        } catch (Exception invalid) { toast(a, invalid.getMessage()); return; }
        if (now != null) {
            now.setEnabled(false);
            now.setText("Downloading…");
        }
        if (later != null) later.setEnabled(true);
        if (progressRow != null) progressRow.setVisibility(View.VISIBLE);
        if (bar != null) {
            bar.setIndeterminate(true);
            bar.setProgress(0);
        }
        if (pct != null) pct.setText("0%");
        AtomicBoolean fail = new AtomicBoolean(false);
        Io.run(a, () -> {
            File apk = download(trusted, expectedSha, (read, total) -> MAIN.post(() -> {
                if (!Io.alive(a) || fail.get()) return;
                if (bar != null) {
                    if (total > 0) {
                        bar.setIndeterminate(false);
                        int p = (int) Math.min(100, (read * 100) / total);
                        bar.setProgress(p);
                        if (pct != null) pct.setText(p + "%");
                    } else if (pct != null) {
                        pct.setText(formatMb(read));
                    }
                }
            }));
            return apk;
        }, file -> {
            if (now != null) {
                now.setEnabled(true);
                now.setText("Install");
            }
            if (file == null || !file.isFile()) {
                fail.set(true);
                recoverDialog(d,later);
                toast(a, "Download fail");
                if (now != null) now.setText("Retry");
                return;
            }
            if (now != null) now.setOnClickListener(v -> install(a, file, expectedSha, version,d,later));
            install(a, file, expectedSha, version,d,later);
        }, e -> {
            fail.set(true);
            if (now != null) {
                now.setEnabled(true);
                now.setText("Retry");
            }
            recoverDialog(d,later);
            toast(a, CineAmitApp.friendlyNetError(e));
        });
    }

    private interface Prog {
        void on(long read, long total);
    }

    private static synchronized File download(String url, String sha, Prog prog) throws Exception {
        cancelDl();
        final String expected = UpdateVerifier.checksum(sha);
        final String base = CineAmitApp.baseUrl();
        okhttp3.HttpUrl target = UpdateVerifier.trustedUrl(base, url);
        File dir = new File(CineAmitApp.get().getFilesDir(), "update");
        if (!dir.exists() && !dir.mkdirs()) throw new java.io.IOException("Update directory unavailable.");
        File out = new File(dir, "cineamit-" + expected + ".apk");
        File tmp = new File(dir, "cineamit-" + expected + ".apk.tmp");
        // Content-addressed files cannot be replaced by a different concurrent update dialog.
        File[] cached = dir.listFiles();
        if (cached != null) for (File old : cached) {
            if (!old.equals(out) && old.getName().matches("cineamit-[a-f0-9]{64}\\.apk(?:\\.tmp)?")
                    && old.lastModified() < System.currentTimeMillis() - TimeUnit.DAYS.toMillis(7)) old.delete();
        }
        OkHttpClient http = Api.client().newBuilder()
                .cookieJar(okhttp3.CookieJar.NO_COOKIES).cache(null)
                .followRedirects(false).followSslRedirects(false)
                .connectTimeout(20, TimeUnit.SECONDS).readTimeout(5, TimeUnit.MINUTES)
                .writeTimeout(30, TimeUnit.SECONDS).callTimeout(5, TimeUnit.MINUTES).build();
        try {
            for (int hop = 0; hop <= 5; hop++) {
                target = UpdateVerifier.trustedUrl(base, target.toString());
                Call call = http.newCall(new Request.Builder().url(target)
                    .header("Accept", "application/vnd.android.package-archive").get().build());
                active = call;
                try (Response res = call.execute()) {
                    if (res.isRedirect()) {
                        String location = res.header("Location");
                        okhttp3.HttpUrl next = location == null ? null : target.resolve(location);
                        if (next == null) throw new java.io.IOException("Invalid update redirect.");
                        target = UpdateVerifier.trustedUrl(base, next.toString());
                        continue;
                    }
                    if (!res.isSuccessful() || res.code() == 206) throw new java.io.IOException("Update HTTP error: " + res.code());
                    ResponseBody body = res.body();
                    if (body == null) throw new java.io.IOException("Empty update response.");
                    long total = body.contentLength(), read = 0;
                    if (total > 90L * 1024 * 1024) throw new java.io.IOException("Update APK too large.");
                    try (InputStream in = body.byteStream(); FileOutputStream fos = new FileOutputStream(tmp)) {
                        byte[] buffer = new byte[32 * 1024]; int n;
                        while ((n = in.read(buffer)) != -1) {
                            AccessGate.requireAllowed();
                            read += n;
                            if (read > 90L * 1024 * 1024) throw new java.io.IOException("Update APK too large.");
                            fos.write(buffer, 0, n);
                            if (prog != null) prog.on(read, total);
                        }
                    }
                    if (!expected.equals(UpdateVerifier.fileChecksum(tmp))) throw new java.io.IOException("Update checksum mismatch.");
                    if (out.exists() && !out.delete()) throw new java.io.IOException("Cannot replace cached update.");
                    if (!tmp.renameTo(out)) throw new java.io.IOException("Cannot save verified update.");
                    return out;
                } finally { if (active == call) active = null; }
            }
            throw new java.io.IOException("Too many update redirects.");
        } finally { if (tmp.exists()) tmp.delete(); }
    }

    private static void recoverDialog(Dialog d, TextView later) {
        // A broken/unreachable artifact must not brick an already installed app.
        // A healthy forced update is still mandatory; failures can be closed and retried.
        d.setCancelable(true);
        if (later!=null) {later.setVisibility(View.VISIBLE);later.setText("Close for now");}
    }

    private static void install(Activity a, File apk, String sha, String version,Dialog d,TextView later) {
        if (!Io.alive(a)) return;
        // Recheck the private cached file on every tap, off the UI thread.
        Io.run(a, () -> { AccessGate.requireAllowed(); UpdateVerifier.verify(a, apk, sha, version); return true; },
            verified -> launchInstaller(a, apk), e -> {recoverDialog(d,later);toast(a, CineAmitApp.friendlyNetError(e));});
    }

    private static void launchInstaller(Activity a, File apk) {
        if (!Io.alive(a) || AccessGate.blocked()) return;
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            try {
                a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
                toast(a, "Allow this app to install its verified update, then tap Install again.");
            } catch (Exception e) { toast(a, "Open system settings to allow this update installation."); }
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(a, a.getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            a.startActivity(intent); // System installer performs final signature/integrity checks and user consent.
        } catch (Exception e) { toast(a, "Install could not start."); }
    }

    private static void cancelDl() {
        Call c = active;
        active = null;
        if (c != null) {
            try { c.cancel(); } catch (Exception ignored) {}
        }
    }

    static int cmp(String a, String b) {
        int[] aa = parts(a);
        int[] bb = parts(b);
        int n = Math.max(aa.length, bb.length);
        for (int i = 0; i < n; i++) {
            int x = i < aa.length ? aa[i] : 0;
            int y = i < bb.length ? bb[i] : 0;
            if (x != y) return Integer.compare(x, y);
        }
        return 0;
    }

    private static int[] parts(String v) {
        if (v == null) return new int[0];
        String s = v.trim().replaceAll("[^0-9.]", "");
        if (s.isEmpty()) return new int[0];
        String[] bits = s.split("\\.");
        int[] out = new int[bits.length];
        for (int i = 0; i < bits.length; i++) {
            try { out[i] = Integer.parseInt(bits[i]); } catch (Exception e) { out[i] = 0; }
        }
        return out;
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    private static String formatMb(long n) {
        if (n < 1024 * 1024) return Math.max(1, n / 1024) + " KB";
        return String.format(java.util.Locale.US, "%.1f MB", n / (1024.0 * 1024.0));
    }

    private static void toast(Activity a, String m) {
        if (Io.alive(a)) Toast.makeText(a, m, Toast.LENGTH_SHORT).show();
    }
}
