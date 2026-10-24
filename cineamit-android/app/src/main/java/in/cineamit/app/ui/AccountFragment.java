package in.cineamit.app.ui;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import org.json.JSONObject;

import java.util.List;

import in.cineamit.app.Io;
import in.cineamit.app.ListActivity;
import in.cineamit.app.LoginActivity;
import in.cineamit.app.MainActivity;
import in.cineamit.app.R;
import in.cineamit.app.Sub;
import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.AppUser;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.data.Models.UserProfile;

public class AccountFragment extends Fragment {
    private View root;
    private UserProfile pinFor;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        root = inflater.inflate(R.layout.fragment_account, container, false);
        Motion.page(root);
        Ui.padForIsland(root);
        tap(R.id.btnSkip, v -> {
            if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).go("home");
        });
        tap(R.id.btnLogin, v -> LoginActivity.open(requireContext()));
        tap(R.id.btnLogout, v -> doLogout());
        tap(R.id.toggleSignup, v -> LoginActivity.open(requireContext(), true));
        tap(R.id.rowSub, v -> in.cineamit.app.PlansActivity.open(requireContext()));
        tap(R.id.rowStudios, v -> ListActivity.open(requireContext(), "studios"));
        tap(R.id.rowProviders, v -> ListActivity.open(requireContext(), "providers"));
        tap(R.id.rowDownloads, v -> in.cineamit.app.DownloadsActivity.open(requireContext()));
        tap(R.id.rowDownloadsGuest, v -> in.cineamit.app.DownloadsActivity.open(requireContext()));
        tap(R.id.rowHistory, v -> in.cineamit.app.PageActivity.open(requireContext(), "history"));
        tap(R.id.rowPlaylists, v -> in.cineamit.app.PageActivity.open(requireContext(), "playlists"));
        tap(R.id.rowNotifications, v -> in.cineamit.app.PageActivity.open(requireContext(), "notifications"));
        tap(R.id.rowMatch, v -> in.cineamit.app.PageActivity.open(requireContext(), "cine_match"));
        tap(R.id.rowWrapped, v -> in.cineamit.app.PageActivity.open(requireContext(), "wrapped"));
        tap(R.id.btnUnlock, v -> unlockPin());
        tap(R.id.rowWhoWatching, v -> in.cineamit.app.ProfilesActivity.open(requireContext()));
        tap(R.id.profilesLabel, v -> in.cineamit.app.ProfilesActivity.open(requireContext()));
        CheckBox auto = root.findViewById(R.id.autoplayBox);
        if (auto != null) auto.setOnCheckedChangeListener((b, on) -> saveAutoplay(on));
        tap(R.id.rowTotp, v -> totpFlow());
        tap(R.id.rowRequest, v -> requestTitle());
        paint();
        return root;
    }

    public void refresh() {
        if (root != null) paint();
    }

    @Override
    public void onResume() {
        super.onResume();
        refresh();
    }

    private void paint() {
        AppUser user = Session.user;
        boolean in = user != null;
        Ui.show(root.findViewById(R.id.loginBg), !in);
        Ui.show(root.findViewById(R.id.loginDim), !in);
        Ui.show(root.findViewById(R.id.guestHeader), !in);
        Ui.show(root.findViewById(R.id.loggedHeader), in);
        if (in) {
            Ui.toolbar(root.findViewById(R.id.loggedHeader), "Account", false, null, false, null);
            TextView tt = root.findViewById(R.id.toolbarTitle);
            if (tt != null) {
                tt.setText("ACCOUNT");
                tt.setTextColor(0xFFF4F1EA);
            }
        }
        TextView guestTitle = root.findViewById(R.id.guestTitle);
        if (guestTitle != null) guestTitle.setText("Account");
        Ui.show(root.findViewById(R.id.loggedInBox), in);
        Ui.show(root.findViewById(R.id.loggedOutBox), !in);
        Ui.show(root.findViewById(R.id.rowWhoWatching), in);
        Ui.show(root.findViewById(R.id.autoplayBox), in);
        Ui.show(root.findViewById(R.id.rowTotp), in && !user.is_kids);
        Ui.show(root.findViewById(R.id.rowRequest), in);
        if (in) {
            String name = user.profile_name != null && !user.profile_name.isEmpty() ? user.profile_name : user.username;
            if (name == null || name.isEmpty()) name = "You";
            setTxt(R.id.signedAs, name);
            TextView av = root.findViewById(R.id.avatarLetter);
            if (av != null) av.setText(name.substring(0, 1).toUpperCase());
            Ui.show(root.findViewById(R.id.kidsBadge), user.is_kids);
            setTxt(R.id.rowSubText, Sub.label());
            String meta = Sub.points() + " pts";
            if (Sub.isPremium()) {
                String till = Sub.expiryText();
                if (till != null && !till.isEmpty()) meta = meta + "  ·  till " + till;
            } else {
                meta = meta + "  ·  tap to upgrade";
            }
            setTxt(R.id.rowSubMeta, meta);
            CheckBox auto = root.findViewById(R.id.autoplayBox);
            if (auto != null) {
                auto.setOnCheckedChangeListener(null);
                auto.setChecked(user.autoplay_next);
                auto.setOnCheckedChangeListener((b, on) -> saveAutoplay(on));
            }
            setTxt(R.id.rowTotpText, user.totp_enabled ? "Two-factor  ·  On" : "Two-factor authentication");
            loadProfiles();
        }
    }

    private void tap(int id, View.OnClickListener l) {
        View v = root.findViewById(id);
        if (v == null) return;
        v.setOnClickListener(l);
        Motion.press(v);
    }

    private void setTxt(int id, String s) {
        TextView t = root.findViewById(id);
        if (t != null) t.setText(s == null ? "" : s);
    }

    private void saveAutoplay(boolean on) {
        if (Session.user == null) return;
        Io.run(this, () -> Api.setPlayback(on), json -> {
            if (json.optBoolean("ok")) {
                JSONObject uo = json.optJSONObject("user");
                if (uo != null) Session.user = Api.parseUser(uo);
                else Session.user.autoplay_next = on;
            } else msg(json.optString("error", "Playback save fail"));
        }, e -> msg(e.getMessage()));
    }

    private void totpFlow() {
        if (Session.user!=null && Session.user.is_kids) {msg("Use an adult profile to manage account security.");return;}
        if (Session.user == null) {
            LoginActivity.open(requireContext());
            return;
        }
        if (Session.user.totp_enabled) {
            EditText pw = new EditText(requireContext());
            pw.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
            pw.setHint("Current password");
            new AlertDialog.Builder(requireContext())
                    .setTitle("Disable 2FA")
                    .setView(pw)
                    .setPositiveButton("Disable", (d, w) -> Io.run(this, () -> Api.totpDisable(pw.getText().toString()), json -> {
                        if (json.optBoolean("ok")) {
                            JSONObject uo = json.optJSONObject("user");
                            if (uo != null) Session.user = Api.parseUser(uo);
                            else Session.user.totp_enabled = false;
                            paint();
                            msg("2FA disabled");
                        } else msg("bad_password".equals(json.optString("error")) ? "Wrong password" : json.optString("error"));
                    }, e -> msg(e.getMessage())))
                    .setNegativeButton("Cancel", null)
                    .show();
            return;
        }
        EditText password=new EditText(requireContext());
        password.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        password.setHint("Current account password");
        new AlertDialog.Builder(requireContext()).setTitle("Enable 2FA")
            .setMessage("Confirm your account password. Social-only account? Reset your password first.")
            .setView(password).setPositiveButton("Continue",(d,w)->beginTotp(password.getText().toString()))
            .setNegativeButton("Cancel",null).show();
    }
    private void beginTotp(String password) {
        Io.run(this, () -> Api.totpSetup(password), json -> {
            if (!json.optBoolean("ok")) {
                String err = json.optString("error");
                if ("already".equals(err)) msg("2FA already on");
                else if ("unavailable".equals(err)) msg("2FA is not available on the server");
                else if ("throttled".equals(err)) msg("Too many tries. Wait.");
                else msg(json.optString("message",err.isEmpty() ? "2FA setup fail" : err));
                return;
            }
            String secret = json.optString("secret");
            try {
                ClipboardManager cm = (ClipboardManager) requireContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("2FA secret", secret));
            } catch (Exception ignored) {}
            EditText code = new EditText(requireContext());
            code.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
            code.setHint("6-digit code");
            new AlertDialog.Builder(requireContext())
                    .setTitle("Enable 2FA")
                    .setMessage("Secret copied. Add it in your authenticator app, then enter the 6-digit code.\n\n" + secret)
                    .setView(code)
                    .setPositiveButton("Verify", (d, w) -> Io.run(this, () -> Api.totpVerify(code.getText().toString().trim()), vj -> {
                        if (vj.optBoolean("ok")) {
                            JSONObject uo = vj.optJSONObject("user");
                            if (uo != null) Session.user = Api.parseUser(uo);
                            else Session.user.totp_enabled = true;
                            paint();
                            msg("2FA enabled");
                        } else {
                            String e = vj.optString("error");
                            if ("bad_code".equals(e)) msg("Wrong code");
                            else if ("expired".equals(e)) msg("Setup expired. Try again.");
                            else msg(e);
                        }
                    }, ex -> msg(ex.getMessage())))
                    .setNegativeButton("Cancel", null)
                    .show();
        }, e -> msg(e.getMessage()));
    }

    private void requestTitle() {
        if (Session.user == null) {
            LoginActivity.open(requireContext());
            return;
        }
        LinearLayout box = new LinearLayout(requireContext());
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(16 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, 0);
        EditText title = new EditText(requireContext());
        title.setHint("Title");
        EditText note = new EditText(requireContext());
        note.setHint("Optional note");
        box.addView(title);
        box.addView(note);
        new AlertDialog.Builder(requireContext())
                .setTitle("Request a title")
                .setView(box)
                .setPositiveButton("Send", (d, w) -> {
                    String t = title.getText().toString().trim();
                    if (t.isEmpty()) {
                        msg("Enter a title.");
                        return;
                    }
                    Io.run(this, () -> Api.submitRequest("movie", t, note.getText().toString().trim()), json -> {
                        if ("login_required".equals(json.optString("error"))) {
                            LoginActivity.open(requireContext());
                            return;
                        }
                        if (json.optBoolean("ok")) msg("Request submitted");
                        else if ("throttled".equals(json.optString("error"))) msg("Too many requests today.");
                        else msg(json.optString("error", "Request fail"));
                    }, e -> msg(e.getMessage()));
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void msg(String m) {
        TextView t = root.findViewById(R.id.message);
        t.setText(m);
        t.setVisibility(m == null || m.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private void doLogout() {
        Io.run(this, Api::logout, json -> {
            Session.user = null;
            in.cineamit.app.data.PersistentCookieJar.get().clear();
            paint();
            msg("Logged out");
        }, e -> {
            Session.user = null;
            in.cineamit.app.data.PersistentCookieJar.get().clear();
            paint();
            msg("Logged out");
        });
    }

    private void loadProfiles() {
        Io.run(this, Api::profiles, json -> {
            List<UserProfile> profiles = Api.parseProfiles(json.optJSONArray("profiles"));
            JSONObject uo = json.optJSONObject("user");
            if (uo != null) Session.user = Api.parseUser(uo);
            LinearLayout row = root.findViewById(R.id.profilesRow);
            row.removeAllViews();
            Ui.show(root.findViewById(R.id.profilesLabel), !profiles.isEmpty());
            AppUser user = Session.user;
            for (UserProfile p : profiles) {
                boolean sel = user != null && p.id == user.profile_id;
                row.addView(Ui.chip(requireContext(), p.name + (p.is_kids ? " · Kids" : ""), sel, v -> selectProfile(p)));
            }
        }, e -> {});
    }

    private void selectProfile(UserProfile p) {
        AppUser user = Session.user;
        if (user != null && user.is_kids && !p.is_kids && p.has_pin) {
            pinFor = p;
            Ui.show(root.findViewById(R.id.pin), true);
            Ui.show(root.findViewById(R.id.btnUnlock), true);
            ((EditText) root.findViewById(R.id.pin)).setHint("PIN for " + p.name);
            return;
        }
        Io.run(this, () -> Api.selectProfile(p.id, ""), json -> {
            if (json.optBoolean("ok")) {
                Session.user = Api.parseUser(json.optJSONObject("user"));
                pinFor = null;
                Ui.show(root.findViewById(R.id.pin), false);
                Ui.show(root.findViewById(R.id.btnUnlock), false);
                paint();
            } else msg(json.optString("error", "Profile switch failed"));
        }, e -> msg(e.getMessage()));
    }

    private void unlockPin() {
        if (pinFor == null) return;
        String pin = ((EditText) root.findViewById(R.id.pin)).getText().toString();
        Io.run(this, () -> Api.selectProfile(pinFor.id, pin), json -> {
            if (json.optBoolean("ok")) {
                Session.user = Api.parseUser(json.optJSONObject("user"));
                pinFor = null;
                Ui.show(root.findViewById(R.id.pin), false);
                Ui.show(root.findViewById(R.id.btnUnlock), false);
                paint();
            } else {
                String err = json.optString("error");
                if ("bad_pin".equals(err)) msg("Wrong PIN");
                else if ("locked".equals(err)) msg("Too many PIN tries. Wait 15 min.");
                else msg(err);
            }
        }, e -> msg(e.getMessage()));
    }
}
