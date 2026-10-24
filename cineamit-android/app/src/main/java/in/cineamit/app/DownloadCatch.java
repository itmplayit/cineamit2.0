package in.cineamit.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import in.cineamit.app.data.PersistentCookieJar;

/**
 * Provider pages are HTML with a Download button → MKV.
 * Auto-clicks first; if captcha / extra step, shows the page so the user can tap.
 */
public final class DownloadCatch {
    public static final class Hit {
        public String url = "";
        public String ua = "";
        public String mime = "";
        public String referer = "";
    }

    private DownloadCatch() {}

    public static Hit grab(String frameUrl, long timeoutMs) {
        if (!WebSecurity.navigationAllowed(frameUrl)) return null;
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<Hit> hit = new AtomicReference<>();
        AtomicReference<WebView> holder = new AtomicReference<>();
        AtomicReference<ViewGroup> overlay = new AtomicReference<>();
        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> start(frameUrl, hit, done, holder, overlay));
        try {
            done.await(Math.max(15000, timeoutMs), TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        main.post(() -> {
            kill(holder.get());
            ViewGroup ov = overlay.get();
            if (ov != null && ov.getParent() instanceof ViewGroup) {
                try { ((ViewGroup) ov.getParent()).removeView(ov); } catch (Exception ignored) {}
            }
        });
        Hit h = hit.get();
        if (h == null || h.url == null || h.url.isEmpty()) return null;
        return h;
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private static void start(String frameUrl, AtomicReference<Hit> hit, CountDownLatch done,
                              AtomicReference<WebView> holder, AtomicReference<ViewGroup> overlayRef) {
        try {
            Activity act = CineAmitApp.foreground();
            Context ctx = act != null ? act : CineAmitApp.get();
            if (ctx == null) {
                done.countDown();
                return;
            }
            float d = ctx.getResources().getDisplayMetrics().density;
            WebView wv = new WebView(ctx);
            holder.set(wv);

            LinearLayout shell = new LinearLayout(ctx);
            shell.setOrientation(LinearLayout.VERTICAL);
            shell.setBackgroundColor(0xF20A0612);
            shell.setPadding(0, Math.round(28 * d), 0, 0);
            overlayRef.set(shell);

            TextView hint = new TextView(ctx);
            hint.setText("Complete the captcha / Download button");
            hint.setTextColor(0xFFF4F1EA);
            hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            hint.setPadding(Math.round(18 * d), Math.round(8 * d), Math.round(18 * d), Math.round(6 * d));
            hint.setVisibility(android.view.View.GONE);

            TextView cancel = new TextView(ctx);
            cancel.setText("Cancel");
            cancel.setTextColor(0xFFC4B5FD);
            cancel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            cancel.setPadding(Math.round(18 * d), Math.round(4 * d), Math.round(18 * d), Math.round(10 * d));
            cancel.setVisibility(android.view.View.GONE);

            LinearLayout.LayoutParams webLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
            shell.addView(hint);
            shell.addView(cancel);
            shell.addView(wv, webLp);

            if (act != null) {
                ViewGroup root = act.findViewById(android.R.id.content);
                if (root != null) {
                    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                            Math.round(320 * d), Math.round(480 * d), Gravity.TOP | Gravity.START);
                    lp.leftMargin = Math.round(4 * d);
                    lp.topMargin = Math.round(4 * d);
                    wv.setAlpha(0.04f);
                    root.addView(shell, lp);
                }
            }

            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            try { cm.setAcceptThirdPartyCookies(wv, true); } catch (Exception ignored) {}
            PersistentCookieJar.get().copyToWebView(cm);
            cm.flush();

            WebSettings s = wv.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setDatabaseEnabled(true);
            s.setSupportMultipleWindows(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setUserAgentString(
                    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
            WebSecurity.harden(wv);

            AtomicBoolean finished = new AtomicBoolean(false);
            AtomicBoolean revealed = new AtomicBoolean(false);
            AtomicInteger pages = new AtomicInteger(0);
            AtomicReference<String> lastPage = new AtomicReference<>(frameUrl);
            Handler main = new Handler(Looper.getMainLooper());

            Runnable finish = () -> {
                if (finished.compareAndSet(false, true)) done.countDown();
            };

            Runnable reveal = () -> {
                if (finished.get() || !revealed.compareAndSet(false, true)) return;
                Activity a = CineAmitApp.foreground();
                if (a == null) return;
                ViewGroup root = a.findViewById(android.R.id.content);
                if (root == null || shell.getParent() == null) return;
                wv.setAlpha(1f);
                hint.setVisibility(android.view.View.VISIBLE);
                cancel.setVisibility(android.view.View.VISIBLE);
                ViewGroup.LayoutParams lp = shell.getLayoutParams();
                lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
                lp.height = ViewGroup.LayoutParams.MATCH_PARENT;
                if (lp instanceof FrameLayout.LayoutParams) {
                    ((FrameLayout.LayoutParams) lp).leftMargin = 0;
                    ((FrameLayout.LayoutParams) lp).topMargin = 0;
                    ((FrameLayout.LayoutParams) lp).gravity = Gravity.FILL;
                }
                shell.setLayoutParams(lp);
            };

            cancel.setOnClickListener(v -> finish.run());

            DownloadListener dl = (url, ua, cd, mime, len) -> {
                if (url != null && url.toLowerCase().startsWith("blob:")) {
                    main.post(reveal);
                    try { wv.evaluateJavascript(SCAN_JS, null); } catch (Exception ignored) {}
                    return;
                }
                if (isJunk(url)) return;
                if (looksFile(url) || looksBinary(mime) || (cd != null && cd.toLowerCase().contains("attachment"))) {
                    Hit h = new Hit();
                    h.url = url;
                    h.ua = ua;
                    h.mime = mime == null ? "" : mime;
                    h.referer = lastPage.get();
                    hit.set(h);
                    finish.run();
                }
            };
            wv.setDownloadListener(dl);
            wv.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                    if (!isUserGesture || resultMsg == null || !(resultMsg.obj instanceof WebView.WebViewTransport)) return false;
                    ((WebView.WebViewTransport) resultMsg.obj).setWebView(view);
                    resultMsg.sendToTarget();
                    return true;
                }
            });

            wv.addJavascriptInterface(new JsBridge(hit, lastPage, finish), "CineDl");

            wv.setWebViewClient(new WebViewClient() {
                @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    if (request != null && request.getUrl() != null && !WebSecurity.resourceAllowed(request.getUrl().toString())) return WebSecurity.blockedResponse();
                    return super.shouldInterceptRequest(view, request);
                }
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (request == null || request.getUrl() == null) return false;
                    return handleNav(request.getUrl().toString(), hit, lastPage, finish);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    return handleNav(url, hit, lastPage, finish);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    lastPage.set(url);
                    int n = pages.incrementAndGet();
                    view.postDelayed(() -> {
                        if (finished.get()) return;
                        try {
                            view.evaluateJavascript(CLICK_JS, null);
                            view.evaluateJavascript(SCAN_JS, null);
                        } catch (Exception ignored) {}
                    }, n == 1 ? 900 : 500);
                }
            });
            wv.loadUrl(frameUrl);
            main.postDelayed(reveal, 8000);
            main.postDelayed(finish, 90000);
        } catch (Exception e) {
            done.countDown();
        }
    }

    private static boolean handleNav(String url, AtomicReference<Hit> hit, AtomicReference<String> lastPage, Runnable finish) {
        if (!WebSecurity.navigationAllowed(url)) return true;
        if (looksFile(url) && !isJunk(url)) {
            Hit h = new Hit();
            h.url = url;
            h.referer = lastPage.get();
            hit.set(h);
            finish.run();
            return true;
        }
        return false;
    }

    static final class JsBridge {
        final AtomicReference<Hit> hit;
        final AtomicReference<String> lastPage;
        final Runnable finish;

        JsBridge(AtomicReference<Hit> hit, AtomicReference<String> lastPage, Runnable finish) {
            this.hit = hit;
            this.lastPage = lastPage;
            this.finish = finish;
        }

        @JavascriptInterface
        public void file(String url) {
            if (!WebSecurity.navigationAllowed(url) || isJunk(url) || !looksFile(url)) return;
            Hit h = new Hit();
            h.url = url;
            h.referer = lastPage.get();
            if (hit.compareAndSet(null, h)) {
                new Handler(Looper.getMainLooper()).post(finish);
            }
        }
    }

    private static void kill(WebView wv) {
        if (wv == null) return;
        try {
            wv.stopLoading();
            wv.setDownloadListener(null);
            wv.setWebChromeClient(null);
            wv.setWebViewClient(null);
            wv.loadUrl("about:blank");
            ViewGroup p = (ViewGroup) wv.getParent();
            if (p != null) p.removeView(wv);
            wv.destroy();
        } catch (Exception ignored) {}
    }

    public static boolean looksFile(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        if (u.startsWith("blob:")) return false;
        if (u.contains(".m3u8") || u.contains(".m3u") || u.contains(".mpd")) return false;
        return u.contains(".mkv") || u.contains(".mp4") || u.contains(".avi")
                || u.contains(".webm") || u.contains(".mov") || u.contains(".m4v")
                || u.contains(".ts") && u.contains("video");
    }

    static boolean looksBinary(String mime) {
        if (mime == null) return false;
        String m = mime.toLowerCase();
        return m.contains("video") || m.contains("octet-stream") || m.contains("matroska")
                || m.contains("mp4") || m.contains("force-download");
    }

    public static boolean isFileHost(String url) {
        if (url == null || url.isEmpty()) return false;
        String u = url.toLowerCase();
        if (looksFile(u)) return true;
        return u.contains("hubcloud") || u.contains("gdflix") || u.contains("filepress")
                || u.contains("pixeldrain") || u.contains("gofile") || u.contains("workupload")
                || u.contains("gdtot") || u.contains("gdlink") || u.contains("drive.google")
                || u.contains("docs.google") || u.contains("googleusercontent")
                || u.contains("workers.dev") || u.contains("r2.dev") || u.contains("mega.nz")
                || u.contains("mediafire") || u.contains("dropbox.com") || u.contains("streamtape")
                || u.contains("mixdrop") || u.contains("fast-dl") || u.contains("photostatic")
                || u.contains("recaptcha") || u.contains("gstatic.com");
    }

    public static boolean isJunk(String url) {
        if (url == null || url.isEmpty()) return true;
        String u = url.toLowerCase();
        return u.contains("/download-frame/") || u.contains("javascript:") || u.startsWith("about:");
    }

    public static boolean isAdUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        if (isFileHost(url)) return false;
        String u = url.toLowerCase();
        if (u.contains("recaptcha") || u.contains("gstatic.com")
                || u.contains("googleusercontent.com") || u.contains("drive.google.com")
                || u.contains("docs.google.com")) return false;
        if (AdBlock.isAdUrl(url)) return true;
        return u.contains("google.com") || u.contains("google.co.")
                || u.contains("googlesyndication") || u.contains("doubleclick")
                || u.contains("googleadservices") || u.contains("adservice.google")
                || u.contains("play.google.com")
                || u.contains("facebook.com") || u.contains("fb.com/") || u.contains("instagram.com")
                || u.contains("youtube.com") || u.contains("youtu.be")
                || u.contains("t.me/") || u.contains("telegram.me")
                || u.contains("twitter.com") || u.contains("x.com/")
                || u.contains("adnxs.com") || u.contains("popads") || u.contains("propeller")
                || u.contains("clickadu") || u.contains("adsterra") || u.contains("ouo.io")
                || u.contains("hai8g.com") || u.contains("highcpmrevenuegate")
                || u.contains("revenuecpmgate") || u.contains("lokhlp.com")
                || u.contains("juicyads") || u.contains("exoclick") || u.contains("exosrv")
                || u.contains("exdynsrv") || u.contains("trafficjunky") || u.contains("tsyndicate")
                || u.contains("trafficstars") || u.contains("hilltopads") || u.contains("popcash")
                || u.contains("admaven") || u.contains("ad-maven") || u.contains("onclickads")
                || u.contains("onclickmax") || u.contains("highperformanceformat")
                || u.contains("trafficfactory") || u.contains("cpmstar") || u.contains("ero-advertising")
                || u.contains("stripchat") || u.contains("chaturbate") || u.contains("pornhub")
                || u.contains("xvideos") || u.contains("xnxx.com") || u.contains("xhamster")
                || u.contains("spankbang") || u.contains("onlyfans") || u.contains("livejasmin")
                || u.contains("bongacams") || u.contains("cam4") || u.contains("adultfriendfinder")
                || u.contains("profitableratecpm") || u.contains("adsco.re")
                || u.contains("phncdn") || u.contains("xhcdn") || u.contains("juicycdn")
                || u.contains("realsrv") || u.contains("popunder") || u.contains("/pop.js")
                || u.contains("ad-delivery") || u.contains("serving-sys")
                || u.contains("zoneid=") || u.contains("bannerid=")
                || u.contains("pushalert") || u.contains("onesignal.com");
    }

    private static final String CLICK_JS =
            "(function(){try{"
                    + "function go(el){try{el.click();}catch(e){}}"
                    + "var nodes=document.querySelectorAll('a,button,input[type=button],input[type=submit],[onclick]');"
                    + "var best=null,score=-1;"
                    + "for(var i=0;i<nodes.length;i++){"
                    + "var el=nodes[i];"
                    + "var t=((el.innerText||'')+' '+(el.value||'')+' '+(el.id||'')+' '+(el.className||'')"
                    + "+' '+(el.getAttribute('href')||'')+' '+(el.getAttribute('download')||'')).toLowerCase();"
                    + "var s=0;"
                    + "if(/\\.mkv|\\.mp4|\\.avi|\\.webm/.test(t)) s+=6;"
                    + "if(/download|get file|save file|direct link|fast download|click here|gdrive|hubcloud|gdflix|filepress/.test(t)) s+=4;"
                    + "if(/480p|720p|1080p|2160p|4k/.test(t)) s+=3;"
                    + "if(el.hasAttribute('download')) s+=5;"
                    + "if(s>score){score=s;best=el;}"
                    + "}"
                    + "if(best&&score>0) go(best);"
                    + "}catch(e){}})();";

    private static final String SCAN_JS =
            "(function(){try{"
                    + "var as=document.querySelectorAll('a[href]');"
                    + "for(var i=0;i<as.length;i++){"
                    + "var h=as[i].href||'';"
                    + "if(/\\.(mkv|mp4|avi|webm|mov)(\\?|$)/i.test(h) && window.CineDl) window.CineDl.file(h);"
                    + "}"
                    + "}catch(e){}})();";
}
