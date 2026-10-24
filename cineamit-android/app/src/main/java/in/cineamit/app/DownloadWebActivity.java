package in.cineamit.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Downloads;
import in.cineamit.app.data.PersistentCookieJar;
import in.cineamit.app.ui.Ui;

public class DownloadWebActivity extends Activity {
    private String key;
    private Downloads.Item item;
    private WebView web;
    private WebView popup;
    private boolean saving;
    private String lastGoodUrl = "";
    private final Handler ads = new Handler(Looper.getMainLooper());
    private int adScrubs;
    private final Runnable scrubAds = new Runnable() {
        @Override public void run() {
            injectBlocker(web);
            injectBlocker(popup);
            if (adScrubs++ < 14) ads.postDelayed(this, 650);
        }
    };

    public static void open(Context ctx, String key) {
        if (ctx == null || key == null || key.isEmpty()) return;
        Intent i = new Intent(ctx, DownloadWebActivity.class).putExtra("key", key);
        if (!(ctx instanceof Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        PersistentCookieJar.get().copyToWebView(cm);
        try { cm.flush(); } catch (Exception ignored) {}
        setContentView(R.layout.activity_download_web);
        key = getIntent().getStringExtra("key");
        item = Downloads.byKey(key);
        if (item == null) {
            Toast.makeText(this, "Download not found", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        ((TextView) findViewById(R.id.dlTitle)).setText(
                item.title == null || item.title.isEmpty() ? "Download" : item.title);
        Ui.tint(findViewById(R.id.btnBack), Color.WHITE);
        findViewById(R.id.btnBack).setOnClickListener(v -> finish());
        Ui.padTopInset(findViewById(R.id.cineHeaderTop));
        setupWeb();
        findViewById(R.id.saveOverlay).setVisibility(View.VISIBLE);
        ((TextView) findViewById(R.id.saveStatus)).setText("Link taiyar ho raha hai…");
        Io.run(this, () -> Downloads.prepareToken(item), ok -> openPage(), e -> openPage());
    }

    private void openPage() {
        findViewById(R.id.saveOverlay).setVisibility(View.GONE);
        String url = item.sourceUrl == null ? "" : item.sourceUrl.trim();
        if (url.isEmpty() || "null".equalsIgnoreCase(url)) url = "";
        if (url.contains("/watch/") || url.contains("/api/secure_play")) url = "";
        if (url.isEmpty() && item.token != null && !item.token.isEmpty()) {
            url = "/download/" + item.token;
        }
        if (url.startsWith("/")) url = Api.abs(url);
        if (url.isEmpty() || url.contains("/watch/")) {
            Toast.makeText(this, "No download links found.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        if (!WebSecurity.navigationAllowed(url)) {
            Toast.makeText(this, "A valid HTTPS download page is required.", Toast.LENGTH_LONG).show(); finish(); return;
        }
        PersistentCookieJar.get().copyToWebView(CookieManager.getInstance());
        lastGoodUrl = url;
        web.loadUrl(url);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWeb() {
        web = findViewById(R.id.web);
        web.setBackgroundColor(0xFF0A0612);
        ProgressBar bar = findViewById(R.id.pageProgress);
        tune(web);
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                bar.setProgress(newProgress);
                bar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (request != null) request.deny();
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                if (!isUserGesture) return false;
                if (resultMsg == null || !(resultMsg.obj instanceof WebView.WebViewTransport)) return false;
                if (popup != null) {
                    try { popup.destroy(); } catch (Exception ignored) {}
                }
                popup = new WebView(view.getContext());
                tune(popup);
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                        String u = req == null || req.getUrl() == null ? "" : req.getUrl().toString();
                        return popupHop(u, v);
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, String url) {
                        return popupHop(url, v);
                    }

                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                        if (req != null && req.getUrl() != null && (!WebSecurity.resourceAllowed(req.getUrl().toString()) || blocked(req.getUrl().toString()))) {
                            return emptyAd();
                        }
                        return super.shouldInterceptRequest(v, req);
                    }

                    @Override
                    public void onPageStarted(WebView v, String url, android.graphics.Bitmap favicon) {
                        if (DownloadCatch.isAdUrl(url) || AdGuardDns.cachedBlock(url)) {
                            try { v.stopLoading(); } catch (Exception ignored) {}
                            try { v.loadUrl("about:blank"); } catch (Exception ignored) {}
                            return;
                        }
                        injectBlocker(v);
                    }

                    @Override
                    public void onPageFinished(WebView v, String url) {
                        if (DownloadCatch.isAdUrl(url)) {
                            try { v.loadUrl("about:blank"); } catch (Exception ignored) {}
                            return;
                        }
                        injectBlocker(v);
                        popupDone(url);
                    }

                    @Override
                    public void onReceivedSslError(WebView v, SslErrorHandler handler, SslError error) {
                        if (handler != null) handler.cancel();
                        Toast.makeText(DownloadWebActivity.this, "HTTPS certificate error. Try another secure server.", Toast.LENGTH_LONG).show();
                    }
                });
                popup.setDownloadListener((url, ua, cd, mime, len) -> catchFile(url, ua, mime, cd));
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
        web.setDownloadListener((url, ua, cd, mime, len) -> catchFile(url, ua, mime, cd));
        web.setWebViewClient(client());
    }

    private boolean popupHop(String url, WebView v) {
        if (!WebSecurity.navigationAllowed(url)) return true;
        if ("about:blank".equals(url)) return false;
        if (DownloadCatch.isAdUrl(url) || AdGuardDns.cachedBlock(url)) return true;
        if (DownloadCatch.looksFile(url) && !DownloadCatch.isJunk(url)) {
            catchFile(url, ua(), "", "");
            return true;
        }
        return false;
    }

    private void popupDone(String url) {
        if (!WebSecurity.navigationAllowed(url) || "about:blank".equals(url)) return;
        if (DownloadCatch.isAdUrl(url) || AdGuardDns.cachedBlock(url)) return;
        if (DownloadCatch.looksFile(url) && !DownloadCatch.isJunk(url)) {
            catchFile(url, ua(), "", "");
            return;
        }
        if (samePage(url)) return;
        if (web != null) web.loadUrl(url);
    }

    private boolean samePage(String u) {
        if (web == null || u == null) return false;
        String cur = web.getUrl();
        if (cur == null) return false;
        return strip(cur).equals(strip(u));
    }

    private static String strip(String u) {
        int h = u.indexOf('#');
        if (h >= 0) u = u.substring(0, h);
        if (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u;
    }

    private void tune(WebView wv) {
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setSupportMultipleWindows(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
        WebSecurity.harden(wv);
        try { CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true); } catch (Exception ignored) {}
        wv.setBackgroundColor(0xFF0A0612);
    }

    private WebViewClient client() {
        return new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return false;
                return hop(request.getUrl().toString(), false);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return hop(url, false);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null
                        && (!WebSecurity.resourceAllowed(request.getUrl().toString()) || blocked(request.getUrl().toString()))) {
                    return emptyAd();
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                if (!WebSecurity.resourceAllowed(url) || blocked(url)) return emptyAd();
                return super.shouldInterceptRequest(view, url);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                injectBlocker(view);
                kickScrub();
                if (DownloadCatch.isAdUrl(url) || AdGuardDns.cachedBlock(url)) {
                    restore();
                    return;
                }
                if (DownloadCatch.looksFile(url) && !DownloadCatch.isJunk(url)) {
                    view.stopLoading();
                    catchFile(url, ua(), "", "");
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && !url.startsWith("about:") && !DownloadCatch.isAdUrl(url)
                        && !AdGuardDns.cachedBlock(url)) lastGoodUrl = url;
                injectBlocker(view);
                kickScrub();
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                if (handler != null) handler.cancel();
                Toast.makeText(DownloadWebActivity.this, "HTTPS certificate error. Try another secure server.", Toast.LENGTH_LONG).show();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (Build.VERSION.SDK_INT >= 24 && request != null && !request.isForMainFrame()) return;
                String fail = request != null && request.getUrl() != null ? request.getUrl().toString() : "";
                if (DownloadCatch.isAdUrl(fail) || AdGuardDns.cachedBlock(fail)) restore();
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (DownloadCatch.isAdUrl(failingUrl) || AdGuardDns.cachedBlock(failingUrl)) restore();
            }
        };
    }

    private void restore() {
        if (web == null) return;
        try { web.stopLoading(); } catch (Exception ignored) {}
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        if (lastGoodUrl != null && !lastGoodUrl.isEmpty()) web.loadUrl(lastGoodUrl);
    }

    private boolean hop(String u, boolean fromPopup) {
        if (!WebSecurity.navigationAllowed(u)) return true;
        String low = u.toLowerCase();
        if (low.startsWith("about:")) return true;
        if (low.startsWith("intent:") || low.startsWith("market:") || low.startsWith("mailto:")
                || low.startsWith("tel:") || low.startsWith("whatsapp:")) return true;
        if (DownloadCatch.isAdUrl(u) || AdGuardDns.cachedBlock(u)) {
            restore();
            return true;
        }
        if (DownloadCatch.looksFile(u) && !DownloadCatch.isJunk(u)) {
            catchFile(u, ua(), "", "");
            return true;
        }
        if (samePage(u)) return true;
        if (fromPopup && web != null) {
            web.loadUrl(u);
            return true;
        }
        return false;
    }

    private String ua() {
        try { return web.getSettings().getUserAgentString(); } catch (Exception e) { return ""; }
    }

    private static boolean blocked(String url) {
        return DownloadCatch.isAdUrl(url) || AdGuardDns.isBlocked(url);
    }

    private void injectBlocker(WebView v) {
        if (v == null) return;
        try { v.evaluateJavascript(SKIP_AD_JS, null); } catch (Exception ignored) {}
        try { v.evaluateJavascript(HIDE_ADS_JS, null); } catch (Exception ignored) {}
    }

    private void kickScrub() {
        ads.removeCallbacks(scrubAds);
        adScrubs = 0;
        ads.post(scrubAds);
    }

    private static WebResourceResponse emptyAd() {
        return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
    }

    /** nxsha ad-seen skip. Ads block; HubCloud / file-host / empty popup allowed. */
    private static final String SKIP_AD_JS =
            "(function(){try{"
                    + "if(window.__cineAdSkip)return;window.__cineAdSkip=1;"
                    + "var gi=Storage.prototype.getItem;"
                    + "Storage.prototype.getItem=function(k){"
                    + "try{if(String(k).indexOf('nxsha_download_ad_seen')===0)return '1';}catch(e){}"
                    + "return gi.call(this,k);};"
                    + "function ad(u){if(u==null||u==='')return false;u=String(u).toLowerCase();"
                    + "if(u==='about:blank'||u.indexOf('javascript:')===0||u==='#')return false;"
                    + "if(/recaptcha|gstatic\\.com|googleusercontent|drive\\.google|docs\\.google/.test(u))return false;"
                    + "if(/\\.(mkv|mp4|avi|webm|mov|zip|rar|7z)(\\?|$)/.test(u))return false;"
                    + "if(/hubcloud|gdflix|filepress|pixeldrain|gofile|workupload|gdtot|gdlink|workers\\.dev|r2\\.dev|mega\\.nz|mediafire|dropbox|streamtape|mixdrop/.test(u))return false;"
                    + "return /hai8g|doubleclick|googlesyndication|adservice|pagead|juicyads|juicycdn|exoclick|exosrv|exdynsrv|trafficjunky|tsyndicate|stripchat|chaturbate|pornhub|xvideos|xnxx\\.com|xhamster|livejasmin|bongacams|onlyfans|phncdn|xhcdn|popads|propeller|adsterra|hilltopads|onclickads|admaven|clickadu|facebook\\.com|instagram\\.com|t\\.me\\/|telegram|popunder|realsrv/.test(u);}"
                    + "var wo=window.open;"
                    + "window.open=function(u,n,f){if(ad(u))return null;"
                    + "if(wo)return wo.call(window,u,n,f);if(u)location.href=u;return window;};"
                    + "if(window.Notification&&Notification.requestPermission){"
                    + "Notification.requestPermission=function(){return Promise.resolve('denied');};}"
                    + "document.addEventListener('click',function(e){"
                    + "var t=e.target&&e.target.closest?e.target.closest('a'):null;"
                    + "if(t&&t.href&&ad(t.href)){e.preventDefault();e.stopPropagation();}"
                    + "},true);"
                    + "}catch(e){}})();";

    private static final String HIDE_ADS_JS =
            "(function(){try{"
                    + "if(!document.getElementById('cine-adblock-css')){"
                    + "var s=document.createElement('style');s.id='cine-adblock-css';"
                    + "s.textContent='iframe[src*=\"doubleclick\"],iframe[src*=\"googlesyndication\"],"
                    + "iframe[src*=\"juicyads\"],iframe[src*=\"exoclick\"],iframe[src*=\"exosrv\"],"
                    + "iframe[src*=\"trafficjunky\"],iframe[src*=\"tsyndicate\"],iframe[src*=\"stripchat\"],"
                    + "iframe[src*=\"chaturbate\"],iframe[src*=\"pornhub\"],iframe[src*=\"xvideos\"],"
                    + "iframe[src*=\"xnxx\"],iframe[src*=\"xhamster\"],iframe[src*=\"livejasmin\"],"
                    + "iframe[src*=\"bongacams\"],iframe[src*=\"popads\"],iframe[src*=\"propeller\"],"
                    + "iframe[src*=\"phncdn\"],iframe[src*=\"xhcdn\"],.adsbygoogle,[id*=\"google_ads\"],"
                    + "[class*=\"adsbox\"]{display:none!important;visibility:hidden!important;"
                    + "pointer-events:none!important;width:0!important;height:0!important;}';"
                    + "(document.head||document.documentElement).appendChild(s);}"
                    + "function keep(el){try{var t=((el.innerText||'')+' '+(el.className||'')+' '+(el.id||'')+' '+(el.href||'')).toLowerCase();"
                    + "return /download|mkv|mp4|1080p|720p|480p|hubcloud|gdrive|filepress|direct|get file|save file/.test(t);}catch(e){return false;}}"
                    + "function dirty(el){if(keep(el))return false;try{var t=((el.src||'')+' '+(el.href||'')).toLowerCase();"
                    + "return /pornhub|xvideos|xnxx\\.com|xhamster|stripchat|chaturbate|juicyads|exoclick|livejasmin|bongacams|phncdn|xhcdn|doubleclick|googlesyndication/.test(t);}catch(e){return false;}}"
                    + "document.querySelectorAll('iframe,a').forEach(function(el){"
                    + "if(dirty(el)){el.style.setProperty('display','none','important');el.style.setProperty('pointer-events','none','important');}});"
                    + "}catch(e){}})();";

    private void catchFile(String url, String ua, String mime, String cd) {
        if (saving || isFinishing()) return;
        if (url != null && url.toLowerCase().startsWith("blob:")) {
            Toast.makeText(this, "Tap a Direct / MKV link on this page", Toast.LENGTH_SHORT).show();
            return;
        }
        if (DownloadCatch.isJunk(url) || DownloadCatch.isAdUrl(url) || AdGuardDns.cachedBlock(url)) return;
        String m = mime == null ? "" : mime.toLowerCase();
        String c = cd == null ? "" : cd.toLowerCase();
        boolean html = m.contains("html") || m.contains("javascript");
        boolean okType = DownloadCatch.looksFile(url)
                || m.contains("video") || m.contains("octet-stream") || m.contains("matroska")
                || m.contains("mp4") || m.contains("force-download") || m.contains("binary")
                || c.contains("attachment") || c.contains("filename");
        if (!okType && html) return;
        if (!okType && !m.isEmpty()) return;
        saving = true;
        DownloadService.askNotify(this);
        DownloadService.started(item.title);
        final String referer = web.getUrl();
        final String title = item.title;
        Io.run(() -> Downloads.pullFile(item, url, referer, ua), done -> {
            if (!Downloads.ST_ACCESS.equals(item.status)) DownloadService.finished(title, done);
        }, e -> { if (!Downloads.ST_ACCESS.equals(item.status)) DownloadService.finished(title, false); });
        Toast.makeText(this, "Download shuru — Downloads page", Toast.LENGTH_SHORT).show();
        DownloadsActivity.open(this);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        ads.removeCallbacks(scrubAds);
        if (popup != null) {
            try { popup.destroy(); } catch (Exception ignored) {}
        }
        if (web != null) {
            try { web.destroy(); } catch (Exception ignored) {}
        }
        super.onDestroy();
    }
}
