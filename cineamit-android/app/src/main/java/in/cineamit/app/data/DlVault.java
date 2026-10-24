package in.cineamit.app.data;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.TextView;
import android.widget.Toast;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

import in.cineamit.app.CineAmitApp;
import in.cineamit.app.Io;
import in.cineamit.app.LoginActivity;
import in.cineamit.app.R;
import in.cineamit.app.data.Models.Session;

/** 4-digit PIN for the Private downloads folder. Session unlock only — lock on leave. */
public final class DlVault {
    private static final String HASH = "dl_pin_hash";
    private static final String SALT = "dl_pin_salt";
    private static final String FAILS = "dl_pin_fails";
    private static final String LOCK_UNTIL = "dl_pin_lock_until";
    private static boolean open;

    private DlVault() {}

    public static boolean hasPin() {
        String h = CineAmitApp.prefs().getString(HASH, "");
        return h != null && !h.isEmpty();
    }

    public static boolean unlocked() {
        return open;
    }

    public static void lock() {
        open = false;
    }

    public static void unlock() {
        open = true;
        CineAmitApp.prefs().edit().putInt(FAILS, 0).apply();
    }

    public static boolean valid(String pin) {
        return pin != null && pin.matches("\\d{4}");
    }

    public static boolean setPin(String pin) {
        if (!valid(pin)) return false;
        String salt = UUID.randomUUID().toString().replace("-", "");
        if (salt.length() > 16) salt = salt.substring(0, 16);
        CineAmitApp.prefs().edit().putString(SALT, salt).putString(HASH, sha(salt, pin)).apply();
        unlock();
        return true;
    }

    public static boolean check(String pin) {
        if (!valid(pin) || !hasPin()) return false;
        String salt = CineAmitApp.prefs().getString(SALT, "");
        return sha(salt, pin).equals(CineAmitApp.prefs().getString(HASH, ""));
    }

    public static void clear() {
        CineAmitApp.prefs().edit().remove(HASH).remove(SALT).putInt(FAILS, 0).apply();
        lock();
    }

    /** Unlock if a PIN exists, or create one. Runs {@code ok} on success. Always asks PIN if locked. */
    public static void ensure(Activity a, Runnable ok) {
        if (a == null || a.isFinishing()) return;
        if (unlocked()) {
            if (ok != null) ok.run();
            return;
        }
        if (!hasPin()) setup(a, ok);
        else enter(a, ok);
    }

    public static void setup(Activity a, Runnable ok) {
        pad(a, "Set PIN", "Create a 4-digit PIN for the private folder.", 4, true, false,
                pin -> {
                    if (!setPin(pin)) {
                        Toast.makeText(a, "PIN was not set", Toast.LENGTH_SHORT).show();
                        return false;
                    }
                    Toast.makeText(a, "Private PIN set", Toast.LENGTH_SHORT).show();
                    if (ok != null) ok.run();
                    return true;
                });
    }

    public static void enter(Activity a, Runnable ok) {
        pad(a, "Private PIN", "Enter PIN to open this folder.", 4, false, true, pin -> {
            long until = CineAmitApp.prefs().getLong(LOCK_UNTIL, 0);
            if (System.currentTimeMillis() < until) {
                Toast.makeText(a, "Too many wrong tries. Wait a bit.", Toast.LENGTH_SHORT).show();
                return false;
            }
            if (!check(pin)) {
                int n = CineAmitApp.prefs().getInt(FAILS, 0) + 1;
                CineAmitApp.prefs().edit().putInt(FAILS, n).apply();
                if (n >= 5) {
                    CineAmitApp.prefs().edit().putLong(LOCK_UNTIL, System.currentTimeMillis() + 30_000L).putInt(FAILS, 0).apply();
                    Toast.makeText(a, "5 wrong PINs. Wait 30 seconds.", Toast.LENGTH_SHORT).show();
                    return true;
                }
                Toast.makeText(a, "Wrong PIN  ·  " + (5 - n) + " tries left", Toast.LENGTH_SHORT).show();
                return false;
            }
            unlock();
            if (ok != null) ok.run();
            return true;
        });
    }

    public static void change(Activity a, Runnable ok) {
        if (!hasPin()) {
            setup(a, ok);
            return;
        }
        pad(a, "Current PIN", "Enter the current PIN first.", 4, false, false, old -> {
            if (!check(old)) {
                Toast.makeText(a, "Wrong PIN", Toast.LENGTH_SHORT).show();
                return false;
            }
            pad(a, "New PIN", "Set a new 4-digit PIN.", 4, true, false, pin -> {
                if (!setPin(pin)) {
                    Toast.makeText(a, "PIN was not set", Toast.LENGTH_SHORT).show();
                    return false;
                }
                Toast.makeText(a, "PIN changed", Toast.LENGTH_SHORT).show();
                if (ok != null) ok.run();
                return true;
            });
            return true;
        });
    }

    /** Email OTP se PIN reset. Files rehti hain. Login zaroori. */
    public static void reset(Activity a, Runnable after) {
        forgot(a, after);
    }

    public static void forgot(Activity a, Runnable after) {
        if (a == null || a.isFinishing()) return;
        if (Session.user == null) {
            Toast.makeText(a, "Sign in to reset PIN. An OTP will be emailed.", Toast.LENGTH_LONG).show();
            LoginActivity.open(a);
            return;
        }
        sendOtpPad(a, after);
    }

    private static void sendOtpPad(Activity a, Runnable after) {
        String masked = Session.user != null && Session.user.emailMasked != null && !Session.user.emailMasked.isEmpty()
                ? Session.user.emailMasked
                : "your email";
        Dialog dlg = makeDlg(a);
        View root = dlg.findViewById(android.R.id.content);
        bindChrome(root, "Reset PIN", "OTP will go to " + masked + ". After verify, set a new PIN.", 0, false);
        View keys = root.findViewById(R.id.pinKeys);
        View send = root.findViewById(R.id.pinSend);
        if (keys != null) keys.setVisibility(View.GONE);
        if (send != null) {
            send.setVisibility(View.VISIBLE);
            send.setOnClickListener(v -> {
                send.setEnabled(false);
                TextView err = root.findViewById(R.id.pinError);
                showErr(err, "Sending OTP…");
                Io.run(a, Api::dlPinOtp, json -> {
                    if (json != null && json.optBoolean("ok")) {
                        String m = json.optString("masked_email", masked);
                        dlg.dismiss();
                        otpEnter(a, m, after);
                    } else {
                        send.setEnabled(true);
                        String e = json == null ? "fail" : json.optString("error", "fail");
                        showErr(err, otpErr(e));
                        if ("login_required".equals(e)) {
                            dlg.dismiss();
                            LoginActivity.open(a);
                        }
                    }
                }, ex -> {
                    send.setEnabled(true);
                    showErr(err, "OTP was not sent. Check your network.");
                });
            });
        }
        TextView cancel = root.findViewById(R.id.pinCancel);
        if (cancel != null) cancel.setOnClickListener(v -> dlg.dismiss());
        dlg.show();
    }

    private static void otpEnter(Activity a, String masked, Runnable after) {
        pad(a, "Email OTP", "6-digit code sent to " + masked + ".", 6, false, false, code -> {
            Io.run(a, () -> Api.dlPinVerify(code), json -> {
                if (json != null && json.optBoolean("ok")) {
                    clear();
                    Toast.makeText(a, "OTP verified. Set a new PIN.", Toast.LENGTH_SHORT).show();
                    setup(a, after);
                } else {
                    String e = json == null ? "fail" : json.optString("error", "fail");
                    Toast.makeText(a, otpErr(e), Toast.LENGTH_SHORT).show();
                    otpEnter(a, masked, after);
                }
            }, ex -> {
                Toast.makeText(a, "OTP check failed", Toast.LENGTH_SHORT).show();
                otpEnter(a, masked, after);
            });
            return true;
        });
    }

    private static String otpErr(String e) {
        if ("login_required".equals(e)) return "Please sign in.";
        if ("throttled".equals(e)) return "Too many requests. Try again later.";
        if ("no_email".equals(e)) return "This account has no email.";
        if ("mail_fail".equals(e)) return "Email could not be sent. Try again later.";
        if ("bad_otp".equals(e) || "totp_invalid".equals(e)) return "Wrong OTP.";
        if ("locked".equals(e)) return "Too many wrong tries. Request a new OTP.";
        return "OTP failed.";
    }

    private interface PinOk {
        /** @return true to close the pad */
        boolean onPin(String pin);
    }

    private static void pad(Activity a, String title, String sub, int len, boolean confirm, boolean showForgot, PinOk ok) {
        if (a == null || a.isFinishing()) return;
        Dialog dlg = makeDlg(a);
        View root = dlg.findViewById(android.R.id.content);
        final String[] first = {null};
        final StringBuilder buf = new StringBuilder();
        bindChrome(root, title, sub, len, showForgot && hasPin());
        TextView err = root.findViewById(R.id.pinError);
        View send = root.findViewById(R.id.pinSend);
        if (send != null) send.setVisibility(View.GONE);
        View keys = root.findViewById(R.id.pinKeys);
        if (keys != null) keys.setVisibility(View.VISIBLE);

        Runnable dots = () -> paintDots(root, buf.length(), len);
        int[] ids = {R.id.pinKey0, R.id.pinKey1, R.id.pinKey2, R.id.pinKey3, R.id.pinKey4,
                R.id.pinKey5, R.id.pinKey6, R.id.pinKey7, R.id.pinKey8, R.id.pinKey9};
        for (int i = 0; i < ids.length; i++) {
            View k = root.findViewById(ids[i]);
            final String digit = String.valueOf(i);
            if (k != null) k.setOnClickListener(v -> {
                if (buf.length() >= len) return;
                buf.append(digit);
                dots.run();
                if (buf.length() < len) return;
                String pin = buf.toString();
                if (confirm) {
                    if (first[0] == null) {
                        first[0] = pin;
                        buf.setLength(0);
                        TextView t = root.findViewById(R.id.pinTitle);
                        TextView s = root.findViewById(R.id.pinSub);
                        if (t != null) t.setText("Confirm PIN");
                        if (s != null) s.setText("Enter the same PIN once more.");
                        dots.run();
                        return;
                    }
                    if (!pin.equals(first[0])) {
                        first[0] = null;
                        buf.setLength(0);
                        TextView t = root.findViewById(R.id.pinTitle);
                        TextView s = root.findViewById(R.id.pinSub);
                        if (t != null) t.setText(title);
                        if (s != null) s.setText(sub);
                        showErr(err, "PIN does not match");
                        dots.run();
                        return;
                    }
                }
                    boolean done = ok == null || ok.onPin(pin);
                if (done) dlg.dismiss();
                else {
                    buf.setLength(0);
                    showErr(err, "Wrong code");
                    dots.run();
                }
            });
        }
        View del = root.findViewById(R.id.pinKeyDel);
        if (del != null) del.setOnClickListener(v -> {
            if (buf.length() > 0) buf.deleteCharAt(buf.length() - 1);
            if (err != null) err.setVisibility(View.GONE);
            dots.run();
        });
        TextView forgot = root.findViewById(R.id.pinForgot);
        if (forgot != null) {
            forgot.setVisibility(showForgot && hasPin() ? View.VISIBLE : View.GONE);
            forgot.setOnClickListener(v -> {
                dlg.dismiss();
                forgot(a, null);
            });
        }
        TextView cancel = root.findViewById(R.id.pinCancel);
        if (cancel != null) cancel.setOnClickListener(v -> dlg.dismiss());
        dots.run();
        dlg.show();
    }

    private static Dialog makeDlg(Activity a) {
        Dialog dlg = new Dialog(a);
        dlg.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dlg.setContentView(R.layout.dialog_pin);
        dlg.setCancelable(true);
        Window w = dlg.getWindow();
        if (w != null) {
            w.setBackgroundDrawable(new ColorDrawable(Color.parseColor("#CC0A0612")));
            w.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT);
            w.setGravity(Gravity.CENTER);
            w.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        return dlg;
    }

    private static void bindChrome(View root, String title, String sub, int len, boolean forgot) {
        TextView t = root.findViewById(R.id.pinTitle);
        TextView s = root.findViewById(R.id.pinSub);
        if (t != null) t.setText(title);
        if (s != null) s.setText(sub);
        int[] dots = {R.id.pinDot1, R.id.pinDot2, R.id.pinDot3, R.id.pinDot4, R.id.pinDot5, R.id.pinDot6};
        int n = len <= 0 ? 0 : Math.min(6, len);
        for (int i = 0; i < dots.length; i++) {
            View d = root.findViewById(dots[i]);
            if (d != null) d.setVisibility(i < n ? View.VISIBLE : View.GONE);
        }
        TextView f = root.findViewById(R.id.pinForgot);
        if (f != null) f.setVisibility(forgot ? View.VISIBLE : View.GONE);
        TextView err = root.findViewById(R.id.pinError);
        if (err != null) err.setVisibility(View.GONE);
    }

    private static void paintDots(View root, int filled, int len) {
        int[] dots = {R.id.pinDot1, R.id.pinDot2, R.id.pinDot3, R.id.pinDot4, R.id.pinDot5, R.id.pinDot6};
        for (int i = 0; i < dots.length; i++) {
            View d = root.findViewById(dots[i]);
            if (d == null) continue;
            if (i >= len) {
                d.setVisibility(View.GONE);
                continue;
            }
            d.setVisibility(View.VISIBLE);
            d.setBackgroundResource(i < filled ? R.drawable.pin_dot_on : R.drawable.pin_dot);
        }
    }

    private static void showErr(TextView err, String msg) {
        if (err == null) return;
        err.setText(msg == null ? "" : msg);
        err.setVisibility(msg == null || msg.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private static String sha(String salt, String pin) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest((salt + ":" + pin).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }
}
