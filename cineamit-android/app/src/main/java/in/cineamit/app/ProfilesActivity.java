package in.cineamit.app;

import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.util.List;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.AppUser;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.data.Models.UserProfile;
import in.cineamit.app.ui.Motion;
import in.cineamit.app.ui.Ui;

public class ProfilesActivity extends AppCompatActivity {
    private boolean fromLogin;
    private boolean fromSplash;
    private boolean manage;
    private boolean busy;
    private String pickColor = "bg-red-600";
    private UserProfile pinFor;
    private UserProfile editPinFor;
    private List<UserProfile> lastProfiles;

    public static void open(Context ctx) {
        Intent i = new Intent(ctx, ProfilesActivity.class);
        if (!(ctx instanceof android.app.Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }

    public static void openAfterLogin(Context ctx, boolean fromSplash) {
        Intent i = new Intent(ctx, ProfilesActivity.class)
                .putExtra("from_login", true)
                .putExtra("from_splash", fromSplash);
        if (fromSplash) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        if (!(ctx instanceof android.app.Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_profiles);
        fromLogin = getIntent().getBooleanExtra("from_login", false);
        fromSplash = getIntent().getBooleanExtra("from_splash", false);

        Ui.padTopInset(findViewById(R.id.cineHeaderTop));
        Motion.kenBurns(findViewById(R.id.loginBg));
        Motion.fadeUp(findViewById(R.id.whoTitle), 40);

        findViewById(R.id.btnManage).setOnClickListener(v -> toggleManage());
        Motion.press(findViewById(R.id.btnManage));
        findViewById(R.id.btnUnlock).setOnClickListener(v -> unlockPin());
        findViewById(R.id.btnPinCancel).setOnClickListener(v -> hidePin());
        findViewById(R.id.btnAddSave).setOnClickListener(v -> saveProfile());
        findViewById(R.id.btnAddCancel).setOnClickListener(v -> hideAdd());
        findViewById(R.id.pinOverlay).setOnClickListener(v -> hidePin());
        findViewById(R.id.pinCard).setOnClickListener(v -> {});
        findViewById(R.id.addOverlay).setOnClickListener(v -> hideAdd());
        findViewById(R.id.addCard).setOnClickListener(v -> {});
        findViewById(R.id.btnSetPinSave).setOnClickListener(v -> saveEditPin(false));
        findViewById(R.id.btnSetPinClear).setOnClickListener(v -> saveEditPin(true));
        findViewById(R.id.btnSetPinCancel).setOnClickListener(v -> hideSetPin());
        findViewById(R.id.setPinOverlay).setOnClickListener(v -> hideSetPin());
        findViewById(R.id.setPinCard).setOnClickListener(v -> {});
        Motion.press(findViewById(R.id.btnUnlock));
        Motion.press(findViewById(R.id.btnAddSave));

        bindColor(R.id.colorRed, "bg-red-600", 0xFFDC2626);
        bindColor(R.id.colorBlue, "bg-blue-600", 0xFF2563EB);
        bindColor(R.id.colorGreen, "bg-green-600", 0xFF16A34A);
        bindColor(R.id.colorPurple, "bg-purple-600", 0xFF9333EA);
        paintColors();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (findViewById(R.id.pinOverlay).getVisibility() == View.VISIBLE) {
                    hidePin();
                    return;
                }
                if (findViewById(R.id.addOverlay).getVisibility() == View.VISIBLE) {
                    hideAdd();
                    return;
                }
                if (findViewById(R.id.setPinOverlay).getVisibility() == View.VISIBLE) {
                    hideSetPin();
                    return;
                }
                leave();
            }
        });
        load();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (findViewById(R.id.profileGrid) != null
                && ((LinearLayout) findViewById(R.id.profileGrid)).getChildCount() == 0) {
            load();
        }
    }

    private void load() {
        Io.run(this, Api::profiles, json -> {
            if (!json.optBoolean("ok")) {
                msg(json.optString("error", "Could not load profiles"));
                return;
            }
            JSONObject uo = json.optJSONObject("user");
            if (uo != null) Session.user = Api.parseUser(uo);
            lastProfiles = Api.parseProfiles(json.optJSONArray("profiles"));
            paint();
        }, e -> msg(CineAmitApp.friendlyNetError(e)));
    }

    private void paint() {
        AppUser user = Session.user;
        boolean kids = user != null && user.is_kids;
        Ui.show(findViewById(R.id.kidsHint), kids);
        LinearLayout grid = findViewById(R.id.profileGrid);
        grid.removeAllViews();
        List<UserProfile> profiles = lastProfiles;
        if (profiles == null) return;
        LinearLayout row = null;
        int col = 0;
        int n = profiles.size();
        boolean showAdd = n < 5;
        int total = n + (showAdd ? 1 : 0);
        for (int i = 0; i < total; i++) {
            if (col == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setGravity(Gravity.CENTER);
                grid.addView(row);
            }
            View tile;
            if (i < n) tile = makeTile(profiles.get(i), n > 1, kids);
            else tile = makeAddTile();
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            row.addView(tile, lp);
            Motion.popIn(tile, i * 40L);
            col++;
            if (col == 3) col = 0;
        }
        while (col > 0 && col < 3) {
            View spacer = new View(this);
            row.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1f));
            col++;
        }
        paintManageBtn();
    }

    private View makeTile(UserProfile p, boolean canDelete, boolean kidsMode) {
        View tile = LayoutInflater.from(this).inflate(R.layout.item_profile_tile, null);
        TextView avatar = tile.findViewById(R.id.avatar);
        TextView name = tile.findViewById(R.id.profileName);
        name.setText(p.name);
        String letter = p.name == null || p.name.isEmpty() ? "?" : p.name.substring(0, 1).toUpperCase();
        avatar.setText(letter);
        avatar.setBackground(avatarBg(colorOf(p.color), selected(p)));
        boolean locked = p.has_pin;
        boolean blocked = kidsMode && !p.is_kids && !p.has_pin;
        Ui.show(tile.findViewById(R.id.lockDim), locked || blocked);
        Ui.show(tile.findViewById(R.id.lockIcon), locked || blocked);
        Ui.show(tile.findViewById(R.id.kidsBadge), p.is_kids);
        ImageView del = tile.findViewById(R.id.btnDelete);
        Ui.show(del, manage && canDelete);
        if (manage && canDelete) {
            del.setOnClickListener(v -> confirmDelete(p));
        }
        name.setTextColor(selected(p) ? 0xFFC4B5FD : 0xFF9CA3AF);
        tile.setAlpha(blocked ? 0.5f : 1f);
        Motion.press(tile);
        tile.setOnClickListener(v -> {
            if (manage) {
                showSetPin(p);
                return;
            }
            tapProfile(p, kidsMode);
        });
        return tile;
    }

    private View makeAddTile() {
        View tile = LayoutInflater.from(this).inflate(R.layout.item_profile_tile, null);
        TextView avatar = tile.findViewById(R.id.avatar);
        avatar.setText("");
        avatar.setBackgroundResource(R.drawable.bg_profile_add);
        Ui.show(tile.findViewById(R.id.addIcon), true);
        ((TextView) tile.findViewById(R.id.profileName)).setText("Add Profile");
        Motion.press(tile);
        tile.setOnClickListener(v -> showAdd());
        return tile;
    }

    private void tapProfile(UserProfile p, boolean kidsMode) {
        if (kidsMode && !p.is_kids && !p.has_pin) {
            msg("Set a PIN on this adult profile to exit Kids Mode");
            return;
        }
        if (kidsMode && !p.is_kids && p.has_pin) {
            showPin(p);
            return;
        }
        select(p, "");
    }

    private void select(UserProfile p, String pin) {
        if (busy) return;
        busy = true;
        Io.run(this, () -> Api.selectProfile(p.id, pin), json -> {
            busy = false;
            if (json.optBoolean("ok")) {
                Session.user = Api.parseUser(json.optJSONObject("user"));
                hidePin();
                goHome();
            } else {
                String err = json.optString("error");
                if ("bad_pin".equals(err)) msg("Wrong PIN");
                else if ("locked".equals(err)) msg("Too many PIN tries. Wait 15 min.");
                else msg(err.isEmpty() ? "Profile switch failed" : err);
            }
        }, e -> {
            busy = false;
            msg(CineAmitApp.friendlyNetError(e));
        });
    }

    private void showPin(UserProfile p) {
        pinFor = p;
        ((TextView) findViewById(R.id.pinTitle)).setText("Unlock " + p.name);
        ((EditText) findViewById(R.id.pinInput)).setText("");
        Ui.show(findViewById(R.id.pinOverlay), true);
        findViewById(R.id.pinInput).requestFocus();
    }

    private void hidePin() {
        pinFor = null;
        Ui.show(findViewById(R.id.pinOverlay), false);
    }

    private void unlockPin() {
        if (pinFor == null) return;
        String pin = ((EditText) findViewById(R.id.pinInput)).getText().toString().trim();
        if (pin.length() < 4) {
            msg("Enter a 4-digit PIN.");
            return;
        }
        select(pinFor, pin);
    }

    private void showAdd() {
        if (lastProfiles != null && lastProfiles.size() >= 5) {
            msg("Maximum 5 profiles.");
            return;
        }
        ((EditText) findViewById(R.id.addName)).setText("");
        ((CheckBox) findViewById(R.id.addKids)).setChecked(false);
        pickColor = "bg-red-600";
        paintColors();
        Ui.show(findViewById(R.id.addOverlay), true);
        findViewById(R.id.addName).requestFocus();
    }

    private void hideAdd() {
        Ui.show(findViewById(R.id.addOverlay), false);
    }

    private void showSetPin(UserProfile p) {
        editPinFor = p;
        ((TextView) findViewById(R.id.setPinTitle)).setText("PIN · " + p.name);
        ((EditText) findViewById(R.id.setPinInput)).setText("");
        Ui.show(findViewById(R.id.setPinOverlay), true);
        findViewById(R.id.setPinInput).requestFocus();
    }

    private void hideSetPin() {
        editPinFor = null;
        Ui.show(findViewById(R.id.setPinOverlay), false);
    }

    private void saveEditPin(boolean clear) {
        if (editPinFor == null || busy) return;
        String pin = clear ? "" : ((EditText) findViewById(R.id.setPinInput)).getText().toString().trim();
        if (!clear && !pin.matches("\\d{4}")) {
            msg("Enter a 4-digit PIN.");
            return;
        }
        busy = true;
        final long pid = editPinFor.id;
        Io.run(this, () -> Api.setProfilePin(pid, pin), json -> {
            busy = false;
            if (json.optBoolean("ok")) {
                hideSetPin();
                JSONObject uo = json.optJSONObject("user");
                if (uo != null) Session.user = Api.parseUser(uo);
                lastProfiles = Api.parseProfiles(json.optJSONArray("profiles"));
                paint();
                android.widget.Toast.makeText(this, clear ? "PIN removed" : "PIN saved", android.widget.Toast.LENGTH_SHORT).show();
            } else {
                String err = json.optString("error");
                if ("bad_pin".equals(err)) msg("Enter a 4-digit PIN.");
                else msg(err.isEmpty() ? "PIN save fail" : err);
            }
        }, e -> {
            busy = false;
            msg(CineAmitApp.friendlyNetError(e));
        });
    }

    private void saveProfile() {
        if (busy) return;
        String name = ((EditText) findViewById(R.id.addName)).getText().toString().trim();
        if (name.isEmpty()) {
            msg("Enter a profile name.");
            return;
        }
        boolean kids = ((CheckBox) findViewById(R.id.addKids)).isChecked();
        busy = true;
        Io.run(this, () -> Api.addProfile(name, kids, pickColor), json -> {
            busy = false;
            if (json.optBoolean("ok")) {
                hideAdd();
                JSONObject uo = json.optJSONObject("user");
                if (uo != null) Session.user = Api.parseUser(uo);
                lastProfiles = Api.parseProfiles(json.optJSONArray("profiles"));
                paint();
                msg("");
            } else {
                String err = json.optString("error");
                if ("limit".equals(err)) msg("Maximum 5 profiles.");
                else if ("invalid".equals(err)) msg("Enter a profile name.");
                else msg(err.isEmpty() ? "Could not add profile" : err);
            }
        }, e -> {
            busy = false;
            msg(CineAmitApp.friendlyNetError(e));
        });
    }

    private void confirmDelete(UserProfile p) {
        new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("Delete profile")
                .setMessage("Delete " + p.name + "?")
                .setPositiveButton("Delete", (d, w) -> doDelete(p))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void doDelete(UserProfile p) {
        if (busy) return;
        busy = true;
        Io.run(this, () -> Api.deleteProfile(p.id), json -> {
            busy = false;
            if (json.optBoolean("ok")) {
                JSONObject uo = json.optJSONObject("user");
                if (uo != null) Session.user = Api.parseUser(uo);
                lastProfiles = Api.parseProfiles(json.optJSONArray("profiles"));
                if (lastProfiles != null && lastProfiles.size() <= 1) manage = false;
                paint();
                msg("");
            } else {
                String err = json.optString("error");
                if ("last_profile".equals(err)) msg("Last profile cannot be deleted.");
                else msg(err.isEmpty() ? "Could not delete" : err);
            }
        }, e -> {
            busy = false;
            msg(CineAmitApp.friendlyNetError(e));
        });
    }

    private void toggleManage() {
        manage = !manage;
        paint();
        if (manage) android.widget.Toast.makeText(this, "Tap profile = PIN. Red X = delete.", android.widget.Toast.LENGTH_SHORT).show();
    }

    private void paintManageBtn() {
        TextView btn = findViewById(R.id.btnManage);
        if (manage) {
            btn.setText("DONE");
            btn.setTextColor(0xFF111111);
            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(dp(8));
            bg.setColor(0xFFF4F1EA);
            btn.setBackground(bg);
        } else {
            btn.setText("MANAGE PROFILES");
            btn.setTextColor(0xFF9CA3AF);
            btn.setBackgroundResource(R.drawable.bg_outline_btn);
        }
    }

    private void bindColor(int id, String token, int fill) {
        View v = findViewById(id);
        v.setOnClickListener(x -> {
            pickColor = token;
            paintColors();
        });
        v.setTag(new int[]{fill});
    }

    private void paintColors() {
        paintDot(findViewById(R.id.colorRed), "bg-red-600", 0xFFDC2626);
        paintDot(findViewById(R.id.colorBlue), "bg-blue-600", 0xFF2563EB);
        paintDot(findViewById(R.id.colorGreen), "bg-green-600", 0xFF16A34A);
        paintDot(findViewById(R.id.colorPurple), "bg-purple-600", 0xFF9333EA);
    }

    private void paintDot(View v, String token, int fill) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.OVAL);
        gd.setColor(fill);
        boolean on = token.equals(pickColor);
        gd.setStroke(dp(on ? 3 : 0), 0xFFF4F1EA);
        v.setBackground(gd);
        v.setScaleX(on ? 1.12f : 1f);
        v.setScaleY(on ? 1.12f : 1f);
    }

    private GradientDrawable avatarBg(int color, boolean selected) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.RECTANGLE);
        gd.setCornerRadius(dp(16));
        gd.setColor(color);
        gd.setStroke(dp(selected ? 3 : 0), 0xFFC4B5FD);
        return gd;
    }

    private boolean selected(UserProfile p) {
        AppUser u = Session.user;
        return u != null && p != null && p.id == u.profile_id && u.profile_id > 0;
    }

    private static int colorOf(String token) {
        if (token == null) token = "";
        String t = token.toLowerCase();
        if (t.contains("blue")) return 0xFF2563EB;
        if (t.contains("green")) return 0xFF16A34A;
        if (t.contains("purple")) return 0xFF9333EA;
        return 0xFFDC2626;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void msg(String m) {
        boolean overlay = findViewById(R.id.pinOverlay).getVisibility() == View.VISIBLE
                || findViewById(R.id.addOverlay).getVisibility() == View.VISIBLE;
        if (overlay && m != null && !m.isEmpty()) {
            android.widget.Toast.makeText(this, m, android.widget.Toast.LENGTH_SHORT).show();
        }
        TextView t = findViewById(R.id.message);
        t.setText(m == null ? "" : m);
        t.setVisibility(m == null || m.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private void goHome() {
        if (fromLogin || fromSplash) {
            startActivity(new Intent(this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
        }
        finish();
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
    }

    private void leave() {
        if (fromLogin || fromSplash) goHome();
        else finish();
    }
}
