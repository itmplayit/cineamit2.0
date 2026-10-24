package in.cineamit.app;

import java.util.HashSet;
import java.util.Set;
import okhttp3.HttpUrl;

/** A per-WebView top-level boundary, not a subresource/CDN allowlist. */
final class EmbedNavigationPolicy {
    private static final int MAX_BOOTSTRAP_REDIRECTS = 4;
    private final Set<String> origins = new HashSet<>();
    private final String initialOrigin;
    private final String appOrigin;
    private int redirects;
    private boolean ready;

    EmbedNavigationPolicy(String initialUrl, String appUrl) {
        initialOrigin = origin(initialUrl);
        appOrigin = origin(appUrl);
        // The resolved server is explicitly configured by Admin. Broad legacy ad lists also
        // contain content hosts; they must not veto this admitted player origin.
        if (initialOrigin != null) origins.add(initialOrigin);
    }

    static String origin(String raw) {
        HttpUrl url = HttpUrl.parse(raw == null ? "" : raw);
        if (url == null || !url.isHttps() || !url.username().isEmpty() || !url.password().isEmpty()) return null;
        return "https://" + (url.host().contains(":") ? "[" + url.host() + "]" : url.host()) + ":" + url.port();
    }

    synchronized boolean documentAllowed(String raw) {
        String destination = origin(raw);
        return destination != null && origins.contains(destination);
    }

    synchronized boolean navigate(String raw, boolean serverRedirect) {
        if (documentAllowed(raw)) return true;
        String destination = origin(raw);
        // Permit a small canonical-provider HTTP redirect chain only during bootstrap.
        // Never learn origins from iframe requests, user clicks, or an already-ready document.
        if (initialOrigin == null || origins.isEmpty() || destination == null || ready || !serverRedirect
                || redirects >= MAX_BOOTSTRAP_REDIRECTS || AdBlock.isAdHost(raw)
                || (destination.equals(appOrigin) && !destination.equals(initialOrigin))) return false;
        origins.add(destination);
        redirects++;
        return true;
    }

    synchronized void finished(String raw) {
        if (documentAllowed(raw)) ready = true;
    }
}
