package in.cineamit.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.AppUser;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.ui.Motion;
import in.cineamit.app.ui.Ui;

public class LoginActivity extends AppCompatActivity {
    private boolean signup;
    private boolean totpStep;
    private boolean passVisible;
    private boolean busy;
    private boolean fromSplash;
    private String totpCred = "";

    public static void open(Context ctx) {
        open(ctx, false);
    }

    public static void open(Context ctx, boolean signup) {
        Intent i = new Intent(ctx, LoginActivity.class).putExtra("signup", signup);
        if (!(ctx instanceof android.app.Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);
        fromSplash = getIntent().getBooleanExtra("from_splash", false);
        signup = getIntent().getBooleanExtra("signup", false);

        Ui.padTopInset(findViewById(R.id.cineHeaderTop));
        Motion.kenBurns(findViewById(R.id.loginBg));
        Motion.rise(findViewById(R.id.loginCard), 80);
        Motion.fadeUp(findViewById(R.id.cineHeaderTop), 0);

        String remembered = CineAmitApp.prefs().getString("last_login", "");
        if (!remembered.isEmpty()) ((EditText) findViewById(R.id.username)).setText(remembered);

        findViewById(R.id.btnSkip).setOnClickListener(v -> skip());
        findViewById(R.id.btnLogin).setOnClickListener(v -> {
            if (signup) doRegister();
            else doLogin();
        });
        findViewById(R.id.toggleSignup).setOnClickListener(v -> {
            signup = !signup;
            totpStep = false;
            totpCred = "";
            paint();
        });
        findViewById(R.id.forgot).setOnClickListener(v -> PageActivity.open(this, "forgot"));
        findViewById(R.id.btnShowPass).setOnClickListener(v -> togglePass());
        Motion.press(findViewById(R.id.btnLogin));
        Motion.press(findViewById(R.id.btnSkip));
        Ui.show(findViewById(R.id.btnSkip), fromSplash);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (fromSplash) skip();
                else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
        paint();
        AppUpdate.checkLaunch(this, null);
    }

    private void paint() {
        ((TextView) findViewById(R.id.loginTitle)).setText(
                totpStep ? "Two-Factor" : (signup ? "Sign Up" : "Sign In"));
        ((TextView) findViewById(R.id.loginSub)).setText(totpStep
                ? "Enter the 6-digit code from your authenticator app."
                : (signup
                ? "Create an account for watchlist, profiles, and Live TV."
                : "Sign in for watchlist, profiles, and Live TV."));
        ((EditText) findViewById(R.id.username)).setHint(signup ? "Username" : "Username or email");
        Ui.show(findViewById(R.id.username), !totpStep);
        Ui.show(findViewById(R.id.email), signup && !totpStep);
        View passWrap = (View) findViewById(R.id.password).getParent();
        Ui.show(passWrap, !totpStep);
        Ui.show(findViewById(R.id.confirm), signup && !totpStep);
        Ui.show(findViewById(R.id.totp), totpStep && !signup);
        Ui.show(findViewById(R.id.rememberRow), !totpStep && !signup);
        ((TextView) findViewById(R.id.btnLogin)).setText(
                signup ? "Create account" : (totpStep ? "Verify 2FA" : "Log in"));
        ((TextView) findViewById(R.id.toggleSignup)).setText(
                signup ? "Already have an account?  Log in" : "Don't have an account?  Sign up");
        Ui.show(findViewById(R.id.toggleSignup), !totpStep);
    }

    private void togglePass() {
        passVisible = !passVisible;
        EditText pass = findViewById(R.id.password);
        int start = pass.getSelectionStart();
        pass.setInputType(passVisible
                ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        if (start >= 0) pass.setSelection(Math.min(start, pass.getText().length()));
        ((TextView) findViewById(R.id.btnShowPass)).setText(passVisible ? "HIDE" : "SHOW");
    }

    private void msg(String m) {
        TextView t = findViewById(R.id.message);
        t.setText(m == null ? "" : m);
        t.setVisibility(m == null || m.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private void setBusy(boolean on) {
        busy = on;
        findViewById(R.id.loginProgress).setVisibility(on ? View.VISIBLE : View.GONE);
        findViewById(R.id.btnLogin).setEnabled(!on);
        findViewById(R.id.btnLogin).setAlpha(on ? 0.55f : 1f);
    }

    private boolean saveUrlIfNeeded() {
        return true;
    }

    private void rememberUser(String user) {
        CheckBox box = findViewById(R.id.remember);
        if (box != null && box.isChecked() && user != null && !user.isEmpty()) {
            CineAmitApp.prefs().edit().putString("last_login", user).apply();
        }
    }

    private void skip() {
        CineAmitApp.prefs().edit().putBoolean("guest_ok", true).apply();
        goNext();
    }

    private void loggedIn(AppUser user) {
        Session.user = user;
        totpStep = false;
        totpCred = "";
        Analytics.login();
        CineAmitApp.prefs().edit().putBoolean("guest_ok", true).apply();
        ProfilesActivity.openAfterLogin(this, fromSplash);
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
        finish();
    }

    private void goNext() {
        if (fromSplash) {
            startActivity(new Intent(this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
        }
        finish();
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
    }

    private void doLogin() {
        if (busy) return;
        if (!saveUrlIfNeeded()) return;
        String user = ((EditText) findViewById(R.id.username)).getText().toString().trim();
        String pass = ((EditText) findViewById(R.id.password)).getText().toString();
        String totp = ((EditText) findViewById(R.id.totp)).getText().toString().trim();
        if (!totpStep && (user.isEmpty() || pass.isEmpty())) {
            msg("Enter username and password.");
            return;
        }
        if (totpStep && totp.isEmpty()) {
            msg("Enter the 6-digit 2FA code.");
            return;
        }
        setBusy(true);
        rememberUser(user);
        Io.run(this, () -> Api.login(user, pass, totp, totpCred), json -> {
            setBusy(false);
            handleLogin(json);
        }, e -> {
            setBusy(false);
            msg(CineAmitApp.friendlyNetError(e));
        });
    }

    private void handleLogin(JSONObject json) {
        if (json.optBoolean("ok")) {
            loggedIn(Api.parseUser(json.optJSONObject("user")));
            return;
        }
        String err = json.optString("error");
        switch (err) {
            case "invalid_login":
            case "invalid_credentials":
                msg("Wrong username or password");
                break;
            case "throttled":
                msg("Too many attempts. Wait a bit.");
                break;
            case "totp_required":
                totpStep = true;
                totpCred = json.optString("totp_cred");
                paint();
                msg("Enter the 6-digit code from your authenticator app.");
                break;
            case "totp_invalid":
                totpStep = true;
                if (!json.optString("totp_cred").isEmpty()) totpCred = json.optString("totp_cred");
                int left = json.optInt("left", -1);
                msg(left >= 0 ? "Wrong 2FA code. " + left + " tries left." : "Wrong 2FA code.");
                paint();
                break;
            case "totp_expired":
                totpStep = false;
                totpCred = "";
                paint();
                msg("2FA session expired. Enter your password again.");
                break;
            case "locked":
                msg("Account locked. 15 min wait.");
                break;
            case "suspended":
                msg("Account suspended");
                break;
            default:
                msg(err.isEmpty() ? "Login failed" : err);
        }
    }

    private void doRegister() {
        if (busy) return;
        if (!saveUrlIfNeeded()) return;
        String username = ((EditText) findViewById(R.id.username)).getText().toString().trim();
        String email = ((EditText) findViewById(R.id.email)).getText().toString().trim();
        String password = ((EditText) findViewById(R.id.password)).getText().toString();
        String confirm = ((EditText) findViewById(R.id.confirm)).getText().toString();
        if (username.isEmpty() || email.isEmpty() || password.isEmpty()) {
            msg("Enter username, email, and password.");
            return;
        }
        setBusy(true);
        rememberUser(username);
        Io.run(this, () -> Api.register(username, email, password, confirm), json -> {
            setBusy(false);
            if (json.optBoolean("ok")) {
                AppUser u = Api.parseUser(json.optJSONObject("user"));
                signup = false;
                Analytics.signUp();
                if (u != null) {
                    loggedIn(u);
                } else {
                    paint();
                    msg("Account created. Sign in now.");
                }
                return;
            }
            String err = json.optString("error");
            switch (err) {
                case "closed": msg("Registration is closed."); break;
                case "throttled": msg("Too many sign-ups. Wait an hour."); break;
                case "bad_email": msg("Enter a valid email."); break;
                case "bad_username": msg("Username 3-50 letters, numbers, dot, underscore."); break;
                case "mismatch": msg("Passwords do not match."); break;
                case "weak_password": msg("Password 8+ chars, letter + number."); break;
                case "email_taken": msg("Email already registered. Sign in."); break;
                case "username_taken": msg("Username already taken."); break;
                default: msg(err.isEmpty() ? "Sign up failed" : err);
            }
        }, e -> {
            setBusy(false);
            msg(CineAmitApp.friendlyNetError(e));
        });
    }
}
