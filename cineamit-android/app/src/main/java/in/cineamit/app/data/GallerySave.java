package in.cineamit.app.data;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

import in.cineamit.app.CineAmitApp;
import okhttp3.Request;
import okhttp3.Response;

/** Copy a finished download or poster into the device Gallery (Movies / Pictures). */
public final class GallerySave {
    public static final int REQ = 7421;
    private static final String ALBUM_VIDEO = "CineAmit";
    private static final String ALBUM_IMG = "CineAmit";

    private GallerySave() {}

    public static boolean needWrite() {
        if (Build.VERSION.SDK_INT >= 29) return false;
        Context c = CineAmitApp.get();
        return ContextCompat.checkSelfPermission(c, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED;
    }

    public static void ask(Activity a) {
        if (a == null) return;
        ActivityCompat.requestPermissions(a,
                new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ);
    }

    public static String putVideo(Downloads.Item item) throws Exception {
        if (item == null || item.path == null || item.path.isEmpty()) return null;
        File src = new File(item.path);
        if (!src.isFile() || src.length() < 8 * 1024) return null;
        String ext = extOf(src.getName(), ".mp4");
        String mime = mimeVideo(ext);
        String name = safeName(item.title, ext);
        Context ctx = CineAmitApp.get();
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Video.Media.DISPLAY_NAME, name);
            v.put(MediaStore.Video.Media.MIME_TYPE, mime);
            v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/" + ALBUM_VIDEO);
            v.put(MediaStore.Video.Media.IS_PENDING, 1);
            ContentResolver cr = ctx.getContentResolver();
            Uri uri = cr.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, v);
            if (uri == null && !"video/mp4".equals(mime)) {
                v.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
                uri = cr.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, v);
            }
            if (uri == null) return null;
            try (InputStream in = new FileInputStream(src); OutputStream out = cr.openOutputStream(uri)) {
                if (out == null) {
                    cr.delete(uri, null, null);
                    return null;
                }
                copy(in, out);
            } catch (Exception e) {
                try { cr.delete(uri, null, null); } catch (Exception ignored) {}
                throw e;
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Video.Media.IS_PENDING, 0);
            cr.update(uri, done, null, null);
            return uri.toString();
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), ALBUM_VIDEO);
        if (!dir.exists() && !dir.mkdirs()) return null;
        File dest = unique(dir, name);
        try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dest)) {
            copy(in, out);
        }
        MediaScannerConnection.scanFile(ctx, new String[]{dest.getAbsolutePath()}, new String[]{mime}, null);
        return Uri.fromFile(dest).toString();
    }

    public static String putImageUrl(String title, String url) throws Exception {
        if (url == null || url.isEmpty()) return null;
        Request req = new Request.Builder().url(url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 13) CineAmit")
                .get().build();
        try (Response res = in.cineamit.app.data.Api.client().newCall(req).execute()) {
            if (res.body() == null || !res.isSuccessful()) return null;
            String ctype = String.valueOf(res.header("Content-Type", "image/jpeg")).toLowerCase();
            String ext = ctype.contains("png") ? ".png" : (ctype.contains("webp") ? ".webp" : ".jpg");
            String mime = ctype.contains("png") ? "image/png" : (ctype.contains("webp") ? "image/webp" : "image/jpeg");
            byte[] data = res.body().bytes();
            if (data.length < 64) return null;
            return putImageBytes(title, data, ext, mime);
        }
    }

    public static String putImageBytes(String title, byte[] data, String ext, String mime) throws Exception {
        if (data == null || data.length < 64) return null;
        String name = safeName(title, ext == null ? ".jpg" : ext);
        if (mime == null || mime.isEmpty()) mime = "image/jpeg";
        Context ctx = CineAmitApp.get();
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
            v.put(MediaStore.Images.Media.MIME_TYPE, mime);
            v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM_IMG);
            v.put(MediaStore.Images.Media.IS_PENDING, 1);
            ContentResolver cr = ctx.getContentResolver();
            Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            if (uri == null) return null;
            try (OutputStream out = cr.openOutputStream(uri)) {
                if (out == null) {
                    cr.delete(uri, null, null);
                    return null;
                }
                out.write(data);
            } catch (Exception e) {
                try { cr.delete(uri, null, null); } catch (Exception ignored) {}
                throw e;
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Images.Media.IS_PENDING, 0);
            cr.update(uri, done, null, null);
            return uri.toString();
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM_IMG);
        if (!dir.exists() && !dir.mkdirs()) return null;
        File dest = unique(dir, name);
        try (OutputStream out = new FileOutputStream(dest)) {
            out.write(data);
        }
        MediaScannerConnection.scanFile(ctx, new String[]{dest.getAbsolutePath()}, new String[]{mime}, null);
        return Uri.fromFile(dest).toString();
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
        out.flush();
    }

    private static File unique(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 2; i < 99; i++) {
            File n = new File(dir, base + "-" + i + ext);
            if (!n.exists()) return n;
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    private static String safeName(String title, String ext) {
        String t = title == null || title.trim().isEmpty() ? "CineAmit" : title.trim();
        t = t.replaceAll("[\\\\/:*?\"<>|]+", " ").replaceAll("\\s+", " ").trim();
        if (t.length() > 48) t = t.substring(0, 48).trim();
        if (t.isEmpty()) t = "CineAmit";
        if (ext == null || ext.isEmpty()) ext = ".mp4";
        if (!ext.startsWith(".")) ext = "." + ext;
        return t + ext;
    }

    private static String extOf(String name, String fallback) {
        if (name == null) return fallback;
        int d = name.lastIndexOf('.');
        if (d < 0 || d == name.length() - 1) return fallback;
        return name.substring(d).toLowerCase();
    }

    private static String mimeVideo(String ext) {
        if (".mkv".equals(ext)) return "video/x-matroska";
        if (".webm".equals(ext)) return "video/webm";
        if (".avi".equals(ext)) return "video/x-msvideo";
        return "video/mp4";
    }
}
