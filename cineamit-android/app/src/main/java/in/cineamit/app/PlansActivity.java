package in.cineamit.app;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.TextView;
import android.widget.Toast;

import androidx.fragment.app.FragmentActivity;

import org.json.JSONObject;

import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.Session;
import in.cineamit.app.ui.Motion;
import in.cineamit.app.ui.Ui;

public class PlansActivity extends FragmentActivity {
    private String pick = Sub.FREE;

    public static void open(Context ctx) {
        ctx.startActivity(new Intent(ctx, PlansActivity.class));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_plans);
        Ui.cineHeader(findViewById(android.R.id.content), "Points & plans", v -> finish());
        Ui.padForBanner(findViewById(R.id.plansScroll));
        pick = Sub.plan();
        if (Sub.FREE.equals(pick) && Sub.trialEnabled() && !Sub.trialUsed()) pick = Sub.TRIAL;
        View trial = findViewById(R.id.cardTrial);
        View free = findViewById(R.id.cardFree);
        View month = findViewById(R.id.cardMonthly);
        View year = findViewById(R.id.cardYearly);
        if (trial != null) Motion.press(trial);
        Motion.press(free);
        Motion.press(month);
        Motion.press(year);
        Motion.press(findViewById(R.id.btnChoose));
        Motion.press(findViewById(R.id.btnEarn));
        if (trial != null) trial.setOnClickListener(v -> select(Sub.TRIAL));
        free.setOnClickListener(v -> select(Sub.FREE));
        month.setOnClickListener(v -> select(Sub.MONTHLY));
        year.setOnClickListener(v -> select(Sub.YEARLY));
        findViewById(R.id.btnChoose).setOnClickListener(v -> confirm());
        findViewById(R.id.btnEarn).setOnClickListener(v -> earn());
        findViewById(R.id.btnCancelSub).setOnClickListener(v -> {
            if (Session.user == null) {
                Sub.clear();
                pick = Sub.FREE;
                paint();
                return;
            }
            Io.run(this, Api::walletCancel, json -> {
                Sub.applyRemote(json);
                pick = Sub.FREE;
                paint();
                Toast.makeText(this, "Free plan is on. Ads may return.", Toast.LENGTH_SHORT).show();
            }, e -> Toast.makeText(this, "Plan was not cancelled.", Toast.LENGTH_SHORT).show());
        });
        paint();
        sync();
    }

    @Override
    protected void onResume() {
        super.onResume();
        paint();
        sync();
    }

    private void sync() {
        if (Session.user == null) return;
        Io.run(this, () -> Api.walletSync(Sub.localPayload()), json -> {
            Sub.applyRemote(json);
            paint();
        }, e -> {});
    }

    private void select(String type) {
        pick = type;
        paint();
    }

    private void earn() {
        if (Session.user == null) {
            Toast.makeText(this, "Sign in to earn points.", Toast.LENGTH_SHORT).show();
            LoginActivity.open(this);
            return;
        }
        Ads.showRewarded(this, json -> {
            if (!Io.alive(this)) return;
            if (json == null || !json.optBoolean("ok")) {
                String err = json == null ? "" : json.optString("error");
                Toast.makeText(this, "ads_off".equals(err) ? "Ads are off." : "Points were not added.", Toast.LENGTH_SHORT).show();
                return;
            }
            Sub.applyRemote(json);
            int add = json.optInt("added", Sub.adPoints());
            Toast.makeText(this, "+" + add + " pts  ·  total " + Sub.points(), Toast.LENGTH_SHORT).show();
            paint();
        });
    }

    private void paint() {
        View trialCard = findViewById(R.id.cardTrial);
        boolean trialShow = Sub.TRIAL.equals(Sub.plan()) || (Sub.trialEnabled() && !Sub.trialUsed());
        if (trialCard != null) trialCard.setVisibility(trialShow ? View.VISIBLE : View.GONE);
        View monthCard = findViewById(R.id.cardMonthly);
        View yearCard = findViewById(R.id.cardYearly);
        if (monthCard != null) {
            monthCard.setVisibility(Sub.monthlyEnabled() || Sub.MONTHLY.equals(Sub.plan()) ? View.VISIBLE : View.GONE);
        }
        if (yearCard != null) {
            yearCard.setVisibility(Sub.yearlyEnabled() || Sub.YEARLY.equals(Sub.plan()) ? View.VISIBLE : View.GONE);
        }
        if (Sub.TRIAL.equals(pick) && !trialShow) pick = Sub.plan();
        if (Sub.MONTHLY.equals(pick) && monthCard != null && monthCard.getVisibility() != View.VISIBLE) pick = Sub.plan();
        if (Sub.YEARLY.equals(pick) && yearCard != null && yearCard.getVisibility() != View.VISIBLE) pick = Sub.plan();
        highlight(trialCard, Sub.TRIAL.equals(pick));
        highlight(findViewById(R.id.cardFree), Sub.FREE.equals(pick));
        highlight(monthCard, Sub.MONTHLY.equals(pick));
        highlight(yearCard, Sub.YEARLY.equals(pick));
        ((TextView) findViewById(R.id.plansPoints)).setText(Sub.points() + " pts");
        TextView status = findViewById(R.id.plansStatus);
        if (Sub.isPremium()) {
            String exp = Sub.expiryText();
            status.setText("Plan: " + Sub.label() + (exp.isEmpty() ? "" : "  ·  till " + exp));
        } else if (Sub.trialEnabled() && Sub.trialUsed()) {
            status.setText("Plan: Free  ·  Trial used");
        } else if (Sub.trialEnabled()) {
            status.setText("Plan: Free  ·  " + Sub.trialDays() + "-day trial available");
        } else {
            status.setText("Plan: Free  ·  Watch ads to collect points");
        }
        setTxt(R.id.txtTrialTitle, Sub.ecoLabel("trial", "FREE TRIAL"));
        setTxt(R.id.txtTrialBlurb, Sub.ecoBlurb("trial", "No app ads. Ek baar per account. VIP servers sabke liye free."));
        setTxt(R.id.txtMonthlyTitle, Sub.ecoLabel("monthly", "PREMIUM MONTHLY"));
        setTxt(R.id.txtMonthlyBlurb, Sub.ecoBlurb("monthly", "No app ads. VIP servers remain free for everyone."));
        setTxt(R.id.txtYearlyTitle, Sub.ecoLabel("yearly", "PREMIUM YEARLY  ·  BEST VALUE"));
        setTxt(R.id.txtYearlyBlurb, Sub.ecoBlurb("yearly", "Best value. No app ads. VIP servers sabke liye free."));
        TextView trialDays = findViewById(R.id.txtTrialDays);
        if (trialDays != null) trialDays.setText(Sub.trialDays() + " days  ·  0 pts");
        TextView monthly = findViewById(R.id.txtMonthlyCost);
        if (monthly != null) monthly.setText(Sub.costMonthly() + " pts  ·  " + Sub.daysMonthly() + " days");
        TextView yearly = findViewById(R.id.txtYearlyCost);
        if (yearly != null) yearly.setText(Sub.costYearly() + " pts  ·  " + Sub.daysYearly() + " days");
        TextView earnBtn = findViewById(R.id.btnEarn);
        earnBtn.setText("Watch ad  ·  +" + Sub.adPoints() + " pts");
        TextView go = findViewById(R.id.btnChoose);
        if (Sub.FREE.equals(pick)) go.setText("Stay on Free");
        else if (Sub.TRIAL.equals(pick)) go.setText("Start " + Sub.trialDays() + "-day free trial");
        else if (Sub.MONTHLY.equals(pick)) go.setText("Unlock " + Sub.daysMonthly() + " days  ·  " + Sub.costMonthly() + " pts");
        else go.setText("Unlock " + Sub.daysYearly() + " days  ·  " + Sub.costYearly() + " pts");
        findViewById(R.id.btnCancelSub).setVisibility(Sub.isPremium() ? View.VISIBLE : View.GONE);
        earnBtn.setVisibility(Sub.isPremium() || !Ads.rewardOn() ? View.GONE : View.VISIBLE);
    }

    private void setTxt(int id, String t) {
        TextView v = findViewById(id);
        if (v != null && t != null) v.setText(t);
    }

    private void startTrial() {
        if (!Sub.trialAvailable()) {
            Toast.makeText(this, Sub.isPremium() ? "Premium is already on." : "Trial was already used.", Toast.LENGTH_SHORT).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Free trial")
                .setMessage(Sub.trialDays() + " days without app ads. VIP servers are free for everyone. Third-party player ads may vary. No points spent. Once per account.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Start trial", (d, w) -> {
                    Io.run(this, Api::walletTrial, json -> {
                        if (json == null || !json.optBoolean("ok")) {
                            String err = json == null ? "" : json.optString("error");
                            String msg = "trial_used".equals(err) ? "Trial was already used."
                                    : ("already_premium".equals(err) ? "Premium is already on."
                                    : ("trial_off".equals(err) ? "Trial is off."
                                    : "Trial did not start."));
                            if (json != null) Sub.applyRemote(json);
                            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
                            paint();
                            return;
                        }
                        Sub.applyRemote(json);
                        pick = Sub.plan();
                        Toast.makeText(this, "Trial on till " + Sub.expiryText(), Toast.LENGTH_LONG).show();
                        paint();
                    }, e -> Toast.makeText(this, "Trial did not start.", Toast.LENGTH_SHORT).show());
                })
                .show();
    }

    private void highlight(View card, boolean on) {
        if (card == null) return;
        card.setAlpha(on ? 1f : 0.72f);
        card.setScaleX(on ? 1f : 0.98f);
        card.setScaleY(on ? 1f : 0.98f);
    }

    private void confirm() {
        if (Sub.FREE.equals(pick)) {
            if (Sub.isPremium()) {
                findViewById(R.id.btnCancelSub).performClick();
                return;
            }
            paint();
            return;
        }
        if (Session.user == null) {
            Toast.makeText(this, "Sign in for Premium.", Toast.LENGTH_SHORT).show();
            LoginActivity.open(this);
            return;
        }
        if (Sub.TRIAL.equals(pick)) {
            startTrial();
            return;
        }
        if (Sub.MONTHLY.equals(pick) && !Sub.monthlyEnabled()) {
            Toast.makeText(this, "Monthly plan is off.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (Sub.YEARLY.equals(pick) && !Sub.yearlyEnabled()) {
            Toast.makeText(this, "Yearly plan is off.", Toast.LENGTH_SHORT).show();
            return;
        }
        int need = Sub.cost(pick);
        int have = Sub.points();
        if (have < need) {
            int ads = (int) Math.ceil((need - have) / (double) Sub.adPoints());
            Toast.makeText(this, "Only " + have + " pts. Watch " + ads + " more ads.", Toast.LENGTH_LONG).show();
            return;
        }
        String name = Sub.YEARLY.equals(pick) ? Sub.ecoLabel("yearly", "Premium Yearly") : Sub.ecoLabel("monthly", "Premium Monthly");
        int days = Sub.YEARLY.equals(pick) ? Sub.daysYearly() : Sub.daysMonthly();
        new AlertDialog.Builder(this)
                .setTitle(name)
                .setMessage(need + " points will be spent. Ads off, VIP playback for " + days + " days.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton(need <= 0 ? "Unlock" : ("Spend " + need + " pts"), (d, w) -> {
                    Io.run(this, () -> Api.walletRedeem(pick), json -> {
                        if (json == null || !json.optBoolean("ok")) {
                            JSONObject j = json;
                            int needPts = j != null ? j.optInt("need", need) : need;
                            Toast.makeText(this, "Not enough points (" + Sub.points() + "/" + needPts + ").", Toast.LENGTH_SHORT).show();
                            if (j != null) Sub.applyRemote(j);
                            paint();
                            return;
                        }
                        Sub.applyRemote(json);
                        Toast.makeText(this, Sub.label() + " on till " + Sub.expiryText(), Toast.LENGTH_LONG).show();
                        paint();
                    }, e -> Toast.makeText(this, "Redeem failed.", Toast.LENGTH_SHORT).show());
                })
                .show();
    }
}
