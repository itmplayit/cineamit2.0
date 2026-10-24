package in.cineamit.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import okhttp3.HttpUrl;

/** Defense-in-depth preflight. The system installer remains the cryptographic APK verifier. */
public final class UpdateVerifier {
    private UpdateVerifier() {}

    static String checksum(String sha) throws IOException {
        String value = sha == null ? "" : sha.trim().toLowerCase(Locale.ROOT);
        if (!value.matches("[a-f0-9]{64}")) throw new IOException("Update needs a valid SHA-256 checksum. Upload the APK to your HTTPS server.");
        return value;
    }

    static HttpUrl trustedUrl(String base, String target) throws IOException {
        HttpUrl origin = HttpUrl.parse(base == null ? "" : base);
        HttpUrl url = origin == null ? null : origin.resolve(target == null ? "" : target);
        WebSecurity.requireHttps(origin);
        WebSecurity.requireHttps(url);
        if (!origin.host().equals(url.host()) || origin.port() != url.port())
            throw new IOException("Updates must be hosted on the configured HTTPS server.");
        if (url.fragment() != null) throw new IOException("Invalid update URL.");
        return url;
    }

    static String fileChecksum(File file) throws Exception {
        if (file == null || !file.isFile() || file.length() <= 0 || file.length() > 90L * 1024 * 1024)
            throw new IOException("Invalid update APK size.");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[32 * 1024]; int read;
            while ((read = in.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        return hex.toString();
    }

    public static void verify(Context context, File apk, String expectedSha, String expectedVersion) throws Exception {
        if (!checksum(expectedSha).equals(fileChecksum(apk))) throw new IOException("Update checksum mismatch. Download again.");
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo current = manager.getPackageInfo(context.getPackageName(), flags);
        PackageInfo next = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        verifyIdentity(current, next, context.getPackageName(), expectedVersion);
    }

    @SuppressWarnings("deprecation")
    static void verifyIdentity(PackageInfo current, PackageInfo next, String packageName, String version) throws IOException {
        if (current == null || next == null || !packageName.equals(current.packageName) || !packageName.equals(next.packageName))
            throw new IOException("Update APK has an unexpected package name.");
        if (version == null || version.trim().isEmpty() || !version.equals(next.versionName))
            throw new IOException("Update APK version does not match server metadata.");
        long oldCode = Build.VERSION.SDK_INT >= 28 ? current.getLongVersionCode() : current.versionCode;
        long newCode = Build.VERSION.SDK_INT >= 28 ? next.getLongVersionCode() : next.versionCode;
        if (newCode <= oldCode) throw new IOException("Update APK must have a newer version code.");
        if (!signersMatch(current, next)) throw new IOException("Update signing identity does not match this installed app.");
    }

    @SuppressWarnings("deprecation")
    static boolean signersMatch(PackageInfo current, PackageInfo next) {
        if (Build.VERSION.SDK_INT < 28) return sameSet(current.signatures, next.signatures);
        if (current.signingInfo == null || next.signingInfo == null) return false;
        if (current.signingInfo.hasMultipleSigners() != next.signingInfo.hasMultipleSigners()) return false;
        Signature[] installed = current.signingInfo.getApkContentsSigners();
        Signature[] candidate = next.signingInfo.getApkContentsSigners();
        if (sameSet(installed, candidate)) return true;
        if (current.signingInfo.hasMultipleSigners() || next.signingInfo.hasMultipleSigners()
                || installed == null || candidate == null || installed.length != 1 || candidate.length != 1 || installed[0] == null || candidate[0] == null) return false;
        // Forward-only rotation: the candidate must extend the installed certificate history.
        // PackageManager supplies parsed signing metadata; the OS verifies proof-of-rotation at installation.
        Signature[] before = current.signingInfo.getSigningCertificateHistory();
        Signature[] after = next.signingInfo.getSigningCertificateHistory();
        if (before == null || after == null || before.length == 0 || after.length <= before.length) return false;
        if (!installed[0].equals(before[before.length - 1]) || !candidate[0].equals(after[after.length - 1])) return false;
        for (int i = 0; i < before.length; i++) if (before[i] == null || !before[i].equals(after[i])) return false;
        return true;
    }

    private static boolean sameSet(Signature[] a, Signature[] b) {
        if (a == null || b == null || a.length == 0 || a.length != b.length) return false;
        Set<Signature> aa = new HashSet<>(Arrays.asList(a)), bb = new HashSet<>(Arrays.asList(b));
        return !aa.contains(null) && !bb.contains(null) && aa.size() == a.length && bb.size() == b.length && aa.equals(bb);
    }
}
