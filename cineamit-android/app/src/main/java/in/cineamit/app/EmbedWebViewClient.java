package in.cineamit.app;

import android.graphics.Bitmap;
import android.net.http.SslError;
import android.os.Message;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import okhttp3.HttpUrl;

/** Shared, recoverable provider playback. Subscription must not alter player dependencies. */
final class EmbedWebViewClient extends WebViewClient {
    static final String TAG = "CineEmbed";
    private static final String FILL_PLAYER_JS =
            "(function(){try{var s=document.createElement('style');"
                    + "s.textContent='html,body{margin:0;padding:0;width:100%;height:100%;background:#000;}"
                    + "body>iframe{width:100%!important;height:100%!important;border:0;}' ;"
                    + "(document.head||document.documentElement).appendChild(s);"
                    + "document.body&&(document.body.style.margin='0');}catch(e){}})();";
    private static final String HIDE_ADS_JS =
            "(function(){try{var s=document.createElement('style');"
                    + "s.textContent='iframe[src*=\"doubleclick\"],iframe[src*=\"googlesyndication\"],.adsbygoogle,[id*=\"google_ads_iframe\"],[class*=\"adsbox\"]{display:none!important;}';"
                    + "(document.head||document.documentElement).appendChild(s);}catch(e){}})();";

    interface Events {
        void ready(WebView view);
        void failed(WebView view, String message, boolean rendererGone);
    }

    private final EmbedNavigationPolicy navigation;
    private final boolean hideProviderAds;
    private final Events events;
    private volatile boolean disposed;
    private boolean failed;
    private String mainDocumentUrl;
    private int diagnostics = 16;
    private int consoleEvents;

    EmbedWebViewClient(String url, String appUrl, boolean hideProviderAds, Events events) {
        navigation = new EmbedNavigationPolicy(url, appUrl);
        mainDocumentUrl = url;
        this.hideProviderAds = hideProviderAds;
        this.events = events;
    }

    void dispose() { disposed = true; }

    private synchronized void diagnostic(String event, String url) {
        if (disposed || diagnostics-- <= 0) return;
        // Never log paths, query strings, fragments, console text, cookies or exception messages.
        String origin = EmbedNavigationPolicy.origin(url);
        Log.i(TAG, "event=" + event + ";origin=" + (origin == null ? "none" : origin));
    }

    boolean blockPopup(WebView view, boolean isUserGesture, Message message) {
        // Multiple-window mode stays ON. Declining the popup preserves the parent contents.
        // Do not send a transport, reuse the parent, or launch an arbitrary external intent.
        diagnostic("popup_blocked", null);
        return false;
    }

    boolean console(ConsoleMessage message) {
        if (message != null && consoleEvents++ < 3) diagnostic("console_" + message.messageLevel().name(), null);
        // Consume provider text: WebChromeClient's default forwarding may contain signed URLs.
        return true;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (disposed || failed || request == null || request.getUrl() == null) return true;
        String next = request.getUrl().toString();
        if (!WebSecurity.navigationAllowed(next)) {
            diagnostic("scheme_blocked", next);
            return true;
        }
        // Provider iframe/CDN navigation is not top-level origin admission.
        if (!request.isForMainFrame()) return false;
        boolean allowed = navigation.navigate(next, request.isRedirect());
        if (allowed) mainDocumentUrl = next;
        else diagnostic("top_navigation_blocked", next);
        return !allowed;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (disposed || request == null || request.getUrl() == null) return WebSecurity.blockedResponse();
        String next = request.getUrl().toString();
        if (!WebSecurity.resourceAllowed(next)) {
            diagnostic("resource_scheme_blocked", next);
            return WebSecurity.blockedResponse();
        }
        // Intentionally NO AdBlock.isAdUrl() / synthetic ad 403 here. Provider scripts,
        // manifests and initialization must behave identically for free/trial/premium.
        // Cosmetic hiding and popup/top-navigation protection remain independent.
        return null;
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        if (disposed || failed) return;
        mainDocumentUrl = url;
        diagnostic("main_start", url);
        // Also cover app loads / POST navigations which may skip shouldOverrideUrlLoading.
        if (!navigation.documentAllowed(url)) {
            fail(view, "This server tried to leave the player. Retry or choose another server.", false);
        }
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        if (disposed || failed || view == null || !navigation.documentAllowed(url)) return;
        navigation.finished(url);
        diagnostic("main_ready", url);
        view.evaluateJavascript(FILL_PLAYER_JS, null);
        if (hideProviderAds) view.evaluateJavascript(HIDE_ADS_JS, null);
        events.ready(view);
    }

    private void fail(WebView view, String message, boolean rendererGone) {
        if (disposed || failed) return;
        failed = true;
        diagnostic(rendererGone ? "renderer_gone" : "main_failed", null);
        events.failed(view, message, rendererGone);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request != null && request.isForMainFrame())
            fail(view, "Player could not load. Check your connection, retry or choose another server.", false);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        if (request != null && request.isForMainFrame() && response != null && response.getStatusCode() >= 400)
            fail(view, "This server is temporarily unavailable. Retry or choose another server.", false);
        // Ad/subframe failures must not tear down a successfully playing main document.
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        if (handler != null) handler.cancel();
        // SSL callbacks have no frame flag. Do not replace the parent for a third-party ad's
        // certificate error. Match the current/provisional document (ignoring fragments).
        String failedUrl = error == null ? null : error.getUrl();
        if (view != null && (sameDocument(failedUrl, mainDocumentUrl) || sameDocument(failedUrl, view.getUrl())))
            fail(view, "Secure player connection failed. Use another server; certificates are not bypassed.", false);
        else diagnostic("subresource_ssl_cancelled", null);
    }

    private static boolean sameDocument(String a, String b) {
        HttpUrl left = HttpUrl.parse(a == null ? "" : a);
        HttpUrl right = HttpUrl.parse(b == null ? "" : b);
        return left != null && right != null
                && left.newBuilder().fragment(null).build().equals(right.newBuilder().fragment(null).build());
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        // The owner removes and destroys this dead WebView without calling loadUrl/stopLoading,
        // then provides an explicit user retry which constructs a fresh WebView.
        fail(view, "The player stopped unexpectedly. Retry this server or choose another server.", true);
        return true;
    }
}
