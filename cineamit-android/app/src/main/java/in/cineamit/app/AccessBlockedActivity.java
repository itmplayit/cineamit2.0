package in.cineamit.app;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

/** Non-exported, ad-free guard. Not part of AppScreens' owned/chrome allowlist. */
public final class AccessBlockedActivity extends AppCompatActivity {
    private TextView title, detail;
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xFF0C0913);
        getWindow().setNavigationBarColor(0xFF0C0913);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(0xFF0C0913);
        LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL); panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(28), dp(36), dp(28), dp(36)); scroll.addView(panel);
        TextView brand = text("CINEAMIT", 14, 0xFFBFA6FF); brand.setTypeface(null, Typeface.BOLD); panel.addView(brand);
        TextView icon = text("!", 38, Color.WHITE); icon.setTypeface(null, Typeface.BOLD);
        GradientDrawable badge = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{0xFF8A4CFF,0xFFCC397F});badge.setCornerRadius(dp(22));icon.setBackground(badge);
        LinearLayout.LayoutParams badgeLayout = new LinearLayout.LayoutParams(dp(76), dp(76)); badgeLayout.setMargins(0,dp(30),0,dp(24));panel.addView(icon,badgeLayout);
        title = text("Connection restricted", 28, Color.WHITE);title.setTypeface(null,Typeface.BOLD);panel.addView(title);
        detail = text("Disable your VPN or ad-blocking DNS, then check again.",16,0xFFCECAD9);detail.setPadding(0,dp(18),0,dp(26));panel.addView(detail);
        Button retry = button("Check again", true);retry.setOnClickListener(v -> AccessGate.refresh());panel.addView(retry);
        Button settings = button("Open network settings",false);settings.setOnClickListener(v -> {
            String action = AccessGate.reason() == AccessGate.Reason.VPN ? Settings.ACTION_VPN_SETTINGS : Settings.ACTION_WIRELESS_SETTINGS;
            try { startActivity(new Intent(action)); } catch (RuntimeException ignored) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
        });panel.addView(settings);
        Button privacy = button("Privacy policy",false);privacy.setOnClickListener(v -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(CineAmitApp.baseUrl()+"/privacy"))); } catch(RuntimeException ignored) {}
        });panel.addView(privacy);
        Button exit = button("Exit app",false);exit.setOnClickListener(v -> finishAffinity());panel.addView(exit);
        TextView note = text("Only detected VPN/filtering settings trigger this screen. A normal ad error or slow connection does not.",12,0xFF968EAA);note.setPadding(0,dp(24),0,0);panel.addView(note);
        setContentView(scroll);render(AccessGate.reason());
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { moveTaskToBack(true); }
        });
    }
    void render(AccessGate.Reason reason) {
        if (title == null) return;
        if (reason == AccessGate.Reason.NONE) { title.setText("Checking connection"); detail.setText("Checking your current network settings…"); return; }
        title.setText(reason == AccessGate.Reason.VPN ? "Turn off your VPN" : "Disable ad-blocking DNS");
        detail.setText(reason == AccessGate.Reason.VPN
            ? "An active VPN connection was detected. Disconnect it to continue using CineAmit."
            : "An active ad-filtering DNS service was detected. Disable that filter or use a non-filtering connection, then check again.");
    }
    private int dp(int n) {return Math.round(n*getResources().getDisplayMetrics().density);}
    private TextView text(String s,int size,int color){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setTextColor(color);t.setGravity(Gravity.CENTER);return t;}
    private Button button(String label,boolean primary){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextColor(Color.WHITE);b.setTextSize(15);b.setMinHeight(dp(52));
        GradientDrawable bg=new GradientDrawable();bg.setColor(primary?0xFF8149DD:0xFF21182E);bg.setCornerRadius(dp(14));b.setBackground(bg);
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(54));lp.setMargins(0,dp(12),0,0);b.setLayoutParams(lp);return b;}
}
