package in.cineamit.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import in.cineamit.app.data.Downloads;

public class DownloadService extends Service implements Downloads.Listener {
    private static final String CH = "cine_dl_v2";
    private static final int NID = 71;
    private static final int DONE = 72;

    public static void askNotify(Activity a) {
        if (a == null || Build.VERSION.SDK_INT < 33) return;
        try {
            if (a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                a.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 71);
            }
        } catch (Exception ignored) {}
    }

    public static void ensure() {
        CineAmitApp app = CineAmitApp.get();
        if (app == null) return;
        channel(app);
        Intent i = new Intent(app, DownloadService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(i);
            else app.startService(i);
        } catch (Exception ignored) {}
    }

    public static void started(String title) {
        ensure();
        Context ctx = CineAmitApp.get();
        if (ctx == null) return;
        channel(ctx);
        notify(ctx, NID, title == null || title.isEmpty() ? "CineAmit" : title,
                "Download shuru ho raha hai…", 0, true, true);
    }

    public static void finished(String title, boolean ok) {
        Context ctx = CineAmitApp.get();
        if (ctx == null) return;
        channel(ctx);
        notify(ctx, DONE, title == null || title.isEmpty() ? "CineAmit" : title,
                ok ? "Download complete — tap to watch" : "Download failed — try again",
                100, false, false);
    }

    private static void channel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationChannel ch = new NotificationChannel(CH, "Downloads", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("CineAmit movie downloads");
            ch.setShowBadge(true);
            ch.enableVibration(false);
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        } catch (Exception ignored) {}
    }

    private static void notify(Context ctx, int id, String title, String text, int prog, boolean ongoing, boolean indet) {
        try {
            Intent open = new Intent(ctx, DownloadsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent pi = PendingIntent.getActivity(ctx, id, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CH)
                    .setSmallIcon(R.drawable.ic_file_download)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setOngoing(ongoing)
                    .setOnlyAlertOnce(true)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setContentIntent(pi)
                    .setAutoCancel(!ongoing)
                    .setProgress(100, Math.max(0, Math.min(100, prog)), indet);
            if (Build.VERSION.SDK_INT >= 33 && androidx.core.content.ContextCompat.checkSelfPermission(ctx,
                    Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return;
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (Exception ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        channel(this);
        Downloads.listen(this);
        goForeground();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        goForeground();
        if (!Downloads.busy()) stopNow();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDownloads() {
        if (!Downloads.busy()) {
            stopNow();
            return;
        }
        goForeground();
    }

    @Override
    public void onDestroy() {
        Downloads.unlisten(this);
        super.onDestroy();
    }

    private void goForeground() {
        Notification n = note();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NID, n);
            }
        } catch (Exception e) {
            try { startForeground(NID, n); } catch (Exception ignored) {}
        }
        if (Build.VERSION.SDK_INT < 33 || androidx.core.content.ContextCompat.checkSelfPermission(this,
                Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            try { NotificationManagerCompat.from(this).notify(NID, n); } catch (SecurityException denied) {}
        }
    }

    private void stopNow() {
        try { stopForeground(true); } catch (Exception ignored) {}
        stopSelf();
    }

    private Notification note() {
        Downloads.Item cur = Downloads.current();
        String title = "CineAmit download";
        String text = "Preparing…";
        int prog = 0;
        boolean indet = true;
        if (cur != null) {
            if (cur.title != null && !cur.title.isEmpty()) title = cur.title;
            if (Downloads.ST_RUN.equals(cur.status)) {
                if (cur.total > 0) {
                    text = cur.progress + "%  ·  " + Downloads.prettySize(cur.bytes);
                    prog = Math.max(0, Math.min(100, cur.progress));
                    indet = false;
                } else if (cur.bytes > 0) {
                    text = Downloads.prettySize(cur.bytes) + " download ho raha hai";
                } else {
                    text = "Download shuru…";
                }
            } else if (Downloads.ST_DONE.equals(cur.status)) {
                text = "Complete";
                prog = 100;
                indet = false;
            } else {
                text = "Queued";
            }
        }
        Intent open = new Intent(this, DownloadsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CH)
                .setSmallIcon(R.drawable.ic_file_download)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(pi)
                .setProgress(100, prog, indet)
                .build();
    }
}
