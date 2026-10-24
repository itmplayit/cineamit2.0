package in.cineamit.app;

import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Native, in-place recovery; no provider JS bridge or Activity back navigation. */
final class EmbedRecoveryUi {
    private static final String TAG = "cineamit.embed.recovery";
    private EmbedRecoveryUi() {}

    static void clear(FrameLayout host) {
        if (host == null) return;
        View old = host.findViewWithTag(TAG);
        if (old != null && old.getParent() == host) host.removeView(old);
    }

    static void show(FrameLayout host, String message, Runnable retry, Runnable nextServer) {
        if (host == null) return;
        clear(host);
        int pad = Math.round(12 * host.getResources().getDisplayMetrics().density);
        LinearLayout panel = new LinearLayout(host.getContext());
        panel.setTag(TAG);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(pad, pad, pad, pad);
        panel.setBackgroundColor(Color.BLACK);
        TextView text = new TextView(host.getContext());
        text.setText(message);
        text.setTextColor(Color.WHITE);
        text.setTextSize(13);
        text.setGravity(Gravity.CENTER);
        panel.addView(text, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        if (retry != null) addButton(panel, "Retry server", retry);
        if (nextServer != null) addButton(panel, "Try next server", nextServer);
        host.addView(panel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private static void addButton(LinearLayout panel, String title, Runnable action) {
        Button button = new Button(panel.getContext());
        button.setText(title);
        button.setOnClickListener(v -> { button.setEnabled(false); action.run(); });
        panel.addView(button, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    static void destroy(WebView view, boolean rendererGone) {
        if (view == null) return;
        if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
        if (!rendererGone) {
            view.stopLoading();
            // No loadUrl(about:blank): navigation callbacks during teardown are unnecessary.
        }
        view.destroy();
    }
}
