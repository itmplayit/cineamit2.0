package in.cineamit.app;

import android.os.Build;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;
import okhttp3.HttpUrl;

/** App-owned network/WebView policy. No certificate exceptions or scanner bypasses. */
public final class WebSecurity {
    private WebSecurity() {}

    public static void requireHttps(HttpUrl url) throws IOException {
        if (url == null || !url.isHttps() || !url.username().isEmpty() || !url.password().isEmpty())
            throw new IOException("A valid HTTPS URL without embedded credentials is required.");
    }

    public static void requireAppRequest(okhttp3.Request request) throws IOException {
        requireHttps(request.url());
        if ("app".equals(request.header("X-Cine-Client"))) {
            HttpUrl base = HttpUrl.parse(CineAmitApp.baseUrl());
            requireHttps(base);
            if (!base.host().equals(request.url().host()) || base.port() != request.url().port())
                throw new IOException("Cross-origin API request blocked. Use the canonical HTTPS server URL.");
        }
    }

    public static boolean navigationAllowed(String url) {
        if ("about:blank".equals(url)) return true;
        try { requireHttps(HttpUrl.parse(url == null ? "" : url)); return true; }
        catch (IOException invalid) { return false; }
    }

    public static boolean resourceAllowed(String url) {
        if (url != null && (url.startsWith("data:") || url.startsWith("blob:"))) return true;
        return navigationAllowed(url);
    }

    public static WebResourceResponse blockedResponse() {
        return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked",
            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    @SuppressWarnings("deprecation")
    public static void harden(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        // JS/storage/media and third-party cookies needed by provider players are not blanket-disabled.
    }
}
