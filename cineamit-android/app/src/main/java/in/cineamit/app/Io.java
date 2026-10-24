package in.cineamit.app;

import android.app.Activity;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.fragment.app.Fragment;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class Io {
    private static final ExecutorService POOL = Executors.newCachedThreadPool();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private Io() {}

    public interface Work<T> {
        T run() throws Exception;
    }

    public interface Ok<T> {
        void accept(T value);
    }

    public interface Err {
        void accept(Exception e);
    }

    public static boolean alive(Activity a) {
        if (a == null) return false;
        if (a.isFinishing()) return false;
        return Build.VERSION.SDK_INT < 17 || !a.isDestroyed();
    }

    public static boolean alive(Fragment f) {
        if (f == null || !f.isAdded() || f.isDetached() || f.isRemoving()) return false;
        if (f.getView() == null) return false;
        return alive(f.getActivity());
    }

    public static <T> void run(Work<T> work, Ok<T> ok, Err err) {
        run((Activity) null, work, ok, err);
    }

    public static <T> void run(Fragment f, Work<T> work, Ok<T> ok, Err err) {
        POOL.execute(() -> {
            try {
                T v = work.run();
                MAIN.post(() -> {
                    if (!alive(f)) return;
                    try {
                        if (ok != null) ok.accept(v);
                    } catch (IllegalStateException ignored) {}
                });
            } catch (Exception e) {
                MAIN.post(() -> {
                    if (!alive(f)) return;
                    try {
                        if (err != null) err.accept(e);
                    } catch (IllegalStateException ignored) {}
                });
            }
        });
    }

    public static <T> void run(Activity a, Work<T> work, Ok<T> ok, Err err) {
        POOL.execute(() -> {
            try {
                T v = work.run();
                MAIN.post(() -> {
                    if (a != null && !alive(a)) return;
                    try {
                        if (ok != null) ok.accept(v);
                    } catch (IllegalStateException ignored) {}
                });
            } catch (Exception e) {
                MAIN.post(() -> {
                    if (a != null && !alive(a)) return;
                    try {
                        if (err != null) err.accept(e);
                    } catch (IllegalStateException ignored) {}
                });
            }
        });
    }

    public static void main(Runnable r) {
        MAIN.post(r);
    }
}
