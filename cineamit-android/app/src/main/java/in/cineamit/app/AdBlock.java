package in.cineamit.app;

import android.net.Uri;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

public final class AdBlock {
    private AdBlock() {}

    private static final Pattern VIP = Pattern.compile("\\bvip\\b");
    private static final List<String> AD_PATH = Arrays.asList(
            "/ads/", "/advert", "/popunder", "/prebid", "/adsense",
            "/pagead/", "/aclk", "/adclick"
    );
    private static final Set<String> AD_HOSTS = new HashSet<>(Arrays.asList(
            "doubleclick.net", "googleadservices.com", "googlesyndication.com",
            "adservice.google.com", "pagead2.googlesyndication.com",
            "tpc.googlesyndication.com", "adssettings.google.com",
            "adnxs.com", "adsrvr.org", "adform.net", "adsafeprotected.com",
            "adcash.com", "adsterra.com", "highperformanceformat.com",
            "hilltopads.net", "hilltopads.com", "propellerads.com", "propellerads.net",
            "popads.net", "popcash.net", "popmyads.com", "popin.cc",
            "exoclick.com", "exosrv.com", "exdynsrv.com", "juicyads.com",
            "trafficjunky.net", "ad-maven.com", "admaven.com", "adfly.com",
            "adf.ly", "shorte.st", "ouo.io", "adcolony.com",
            "taboola.com", "outbrain.com", "mgid.com", "revcontent.com",
            "criteo.com", "rubiconproject.com", "pubmatic.com", "openx.net",
            "casalemedia.com", "smartadserver.com", "indexww.com", "bidswitch.net",
            "moatads.com", "ads-twitter.com", "ads.yahoo.com", "advertising.com",
            "media.net", "yieldmo.com", "sharethrough.com", "spotxchange.com",
            "teads.tv", "triplelift.com", "inmobi.com", "unityads.unity3d.com",
            "applovin.com", "ironsrc.com", "vungle.com", "chartboost.com",
            "startappexchange.com", "admob.com", "ad.mail.ru", "yandex.ru",
            "aniview.com", "spotim.market", "zedo.com", "adblade.com",
            "adsupply.com", "clicksor.com", "onclickads.net", "onclickmax.com",
            "onclickmega.com", "onclicksuper.com", "pop.onclkds.com",
            "adserver.yahoo.com", "advertiseserve.com", "advertserve.com",
            "servedbyadbutler.com", "adsco.re", "adskeeper.com",
            "histats.com", "statcounter.com", "mc.yandex.ru",
            "sprout-ad.com", "tsyndicate.com", "trafficstars.com",
            "hai8g.com", "lokhlp.com", "highcpmrevenuegate.com", "revenuecpmgate.com",
            "ero-advertising.com", "cpmstar.com", "trafficfactory.com", "trafficjunky.com",
            "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "spankbang.com",
            "stripchat.com", "chaturbate.com", "livejasmin.com", "bongacams.com",
            "cam4.com", "onlyfans.com", "adultfriendfinder.com", "juicyads.me",
            "admatic.com.tr", "admanmedia.com", "smartyads.com",
            "betweendigital.com", "contextweb.com", "sonobi.com",
            "gumgum.com", "districtm.io", "sovrn.com", "lijit.com",
            "33across.com", "conversantmedia.com", "emxdgt.com",
            "freewheel.tv", "fwmrm.net",
            "phncdn.com", "xhcdn.com", "stripchatcdn.com", "stripchat.global",
            "juicycdn.com", "exoclick.net", "realsrv.com",
            "clickadu.com", "ad-delivery.net", "serving-sys.com", "adtrafficquality.google",
            "googleads.g.doubleclick.net", "partner.googleadservices.com",
            "fundingchoicesmessages.google.com", "pagead2.googleadservices.com",
            "pushalert.co", "onesignal.com", "pushcrew.com", "clevernt.com",
            "profitableratecpm.com", "highcpmrevenuegate.com"
    ));

    public static boolean isVipServer(String name) {
        if (name == null) return false;
        String n = name.toLowerCase();
        return VIP.matcher(n).find() || n.contains("vip ") || n.startsWith("vip")
                || n.endsWith("vip") || n.contains("-vip") || n.contains("vip-");
    }

    /** Host-only navigation guard. Generic path words must not classify player dependencies. */
    public static boolean isAdHost(String raw) {
        if (raw == null) return false;
        try {
            String host = Uri.parse(raw).getHost();
            if (host == null) return false;
            host = host.toLowerCase(java.util.Locale.ROOT);
            while (host.endsWith(".")) host = host.substring(0, host.length() - 1);
            for (String h : AD_HOSTS) if (host.equals(h) || host.endsWith("." + h)) return true;
        } catch (RuntimeException invalid) { return false; }
        return false;
    }

    public static boolean isAdUrl(String raw) {
        if (raw == null || raw.trim().isEmpty()) return false;
        Uri uri;
        try {
            uri = Uri.parse(raw);
        } catch (Exception e) {
            return false;
        }
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase();
        while (host.endsWith(".")) host = host.substring(0, host.length() - 1);
        for (String h : AD_HOSTS) {
            if (host.equals(h) || host.endsWith("." + h)) return true;
        }
        String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase();
        for (String p : AD_PATH) {
            if (path.contains(p)) return true;
        }
        return false;
    }
}
