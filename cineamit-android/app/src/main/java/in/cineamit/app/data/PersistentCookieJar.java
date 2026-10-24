package in.cineamit.app.data;

import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import in.cineamit.app.CineAmitApp;
import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;

public final class PersistentCookieJar implements CookieJar {
    private static PersistentCookieJar instance;
    private final List<Cookie> cache = new ArrayList<>();
    private final java.util.LinkedHashMap<String,Cookie> tombstones = new java.util.LinkedHashMap<>();

    public static synchronized PersistentCookieJar get() {
        if (instance == null) instance = new PersistentCookieJar();
        return instance;
    }

    private PersistentCookieJar() {
        load();
    }

    @Override
    public synchronized void saveFromResponse(HttpUrl url, List<Cookie> cookies) {
        if (cookies == null) return;
        for (Cookie incoming : cookies) {
            try {
                Cookie c = incoming;
                if (!c.persistent()) {
                    Cookie.Builder b = new Cookie.Builder()
                            .name(incoming.name())
                            .value(incoming.value())
                            .path(incoming.path())
                            .expiresAt(System.currentTimeMillis() + 30L * 24 * 3600 * 1000);
                    if (incoming.hostOnly()) b.hostOnlyDomain(incoming.domain());
                    else b.domain(incoming.domain());
                    if (incoming.secure()) b.secure();
                    if (incoming.httpOnly()) b.httpOnly();
                    c = b.build();
                }
                final Cookie keep = c;
                cache.removeIf(x -> x.name().equals(keep.name())
                        && x.domain().equals(keep.domain())
                        && x.path().equals(keep.path()));
                if (keep.expiresAt() > System.currentTimeMillis()) {cache.add(keep);tombstones.remove(keep.name()+"|"+keep.domain()+"|"+keep.path());}
                else rememberExpired(keep);
            } catch (Exception ignored) {
                cache.removeIf(x -> x.name().equals(incoming.name())
                        && x.domain().equals(incoming.domain())
                        && x.path().equals(incoming.path()));
                cache.add(incoming);
            }
        }
        persist();
    }

    @Override
    public synchronized List<Cookie> loadForRequest(HttpUrl url) {
        long now = System.currentTimeMillis();
        List<Cookie> out = new ArrayList<>();
        Iterator<Cookie> it = cache.iterator();
        boolean dirty = false;
        while (it.hasNext()) {
            Cookie c = it.next();
            if (c.expiresAt() <= now) {
                rememberExpired(c);
                it.remove();
                dirty = true;
                continue;
            }
            if (c.matches(url)) out.add(c);
        }
        if (dirty) persist();
        return out;
    }

    public synchronized void clear() {
        cache.clear();
        persist();
        try {
            CookieManager wm = CookieManager.getInstance();
            wm.removeAllCookies(null);
            wm.flush();
        } catch (Exception ignored) {}
    }

    public synchronized void copyToWebView(CookieManager wm) {
        if (wm == null) return;
        okhttp3.HttpUrl base=okhttp3.HttpUrl.parse(CineAmitApp.baseUrl());
        if (base!=null) {
            // v73 wrote these host-only credentials as Domain cookies. Chromium
            // can keep host-only and dotted-domain variants simultaneously.
            // Remove legacy Domain mirrors even if the native entry was pruned
            // before this upgrade; valid native state is restored below.
            for (String name:new String[]{"cineamit_session","cine_wid"})
                wm.setCookie("https://"+base.host()+"/",name+"=; Path=/; Domain="+base.host()+"; Max-Age=0; Secure; HttpOnly");
        }
        for (Cookie expired:tombstones.values()) expireMirror(wm,expired);
        tombstones.clear();
        long now=System.currentTimeMillis();
        Iterator<Cookie> it=cache.iterator();
        boolean dirty=false;
        while (it.hasNext()) {
            Cookie c=it.next();
            try {
                String scheme="https://";
                String host=c.domain().startsWith(".") ? c.domain().substring(1) : c.domain();
                if (c.expiresAt()<=now) {
                    // Clear any older weaker mirror as well as pruning native state.
                    expireMirror(wm,c);
                    it.remove();dirty=true;continue;
                }
                // OkHttp serializes HttpOnly, Secure, expiry and Domain only when
                // genuinely domain-scoped; do not rebuild a weaker cookie by hand.
                String value=c.toString();
                if (c.hostOnly()) wm.setCookie(scheme+host+c.path(),deletion(c)+"; Domain="+c.domain());
                if (base!=null && c.domain().equals(base.host())) value+="; SameSite=Lax";
                wm.setCookie(scheme+host+c.path(),value);
            } catch (RuntimeException ignored) {}
        }
        if (dirty) persist();
    }

    private static String deletion(Cookie c) {
        return c.name()+"=; Path="+c.path()+"; Max-Age=0"+(c.secure()?"; Secure":"")+(c.httpOnly()?"; HttpOnly":"");
    }
    private static void expireMirror(CookieManager wm,Cookie c) {
        String host=c.domain().startsWith(".") ? c.domain().substring(1):c.domain();
        String origin="https://"+host+c.path();
        wm.setCookie(origin,deletion(c));
        wm.setCookie(origin,deletion(c)+"; Domain="+c.domain());
    }
    private void rememberExpired(Cookie c) {
        tombstones.put(c.name()+"|"+c.domain()+"|"+c.path(),c);
        while (tombstones.size()>256) tombstones.remove(tombstones.keySet().iterator().next());
    }

    private void persist() {
        try {
            JSONArray arr = new JSONArray();
            for (Cookie c : cache) {
                JSONObject o = new JSONObject();
                o.put("n", c.name());
                o.put("v", c.value());
                o.put("d", c.domain());
                o.put("p", c.path());
                o.put("e", c.expiresAt());
                o.put("s", c.secure());
                o.put("h", c.httpOnly());
                o.put("ho", c.hostOnly());
                arr.put(o);
            }
            CineAmitApp.prefs().edit().putString("cookies_v1", arr.toString()).apply();
        } catch (Exception ignored) {}
    }

    private void load() {
        try {
            String raw = CineAmitApp.prefs().getString("cookies_v1", "");
            if (raw == null || raw.isEmpty()) return;
            JSONArray arr = new JSONArray(raw);
            long now = System.currentTimeMillis();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                long exp = o.optLong("e", 0);
                try {
                    Cookie.Builder b = new Cookie.Builder()
                            .name(o.optString("n"))
                            .value(o.optString("v"))
                            .path(o.optString("p", "/"))
                            .expiresAt(exp);
                    String domain = o.optString("d");
                    if (o.optBoolean("ho", false)) b.hostOnlyDomain(domain);
                    else b.domain(domain.startsWith(".") ? domain.substring(1) : domain);
                    if (o.optBoolean("s")) b.secure();
                    if (o.optBoolean("h")) b.httpOnly();
                    Cookie restored=b.build();
                    if (exp>now) cache.add(restored);else rememberExpired(restored);
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }
}
