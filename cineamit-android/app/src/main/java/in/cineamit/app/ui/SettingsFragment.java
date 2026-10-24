package in.cineamit.app.ui;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.widget.SwitchCompat;
import androidx.fragment.app.Fragment;

import in.cineamit.app.AppUpdate;
import in.cineamit.app.Ads;
import in.cineamit.app.BuildConfig;
import in.cineamit.app.CineAmitApp;
import in.cineamit.app.PageActivity;
import in.cineamit.app.R;
import in.cineamit.app.data.DlVault;

public class SettingsFragment extends Fragment {
    private View root;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        root = inflater.inflate(R.layout.fragment_setting, container, false);
        Ui.padTopInset(root.findViewById(R.id.cineHeaderTop));
        View scroll = root.findViewById(R.id.settingsScroll);
        Ui.padForIsland(scroll != null ? scroll : root);
        Motion.page(root);

        int[] pressIds = {
                R.id.lytAbout, R.id.lytPrivacy, R.id.lytShareApp, R.id.lytCheckUpdate,
                R.id.lytPages, R.id.lytHelp, R.id.lytContact, R.id.lytTerms,
                R.id.lytPinSet, R.id.lytPinReset, R.id.lytAdsPrivacy
        };
        for (int id : pressIds) {
            View row = root.findViewById(id);
            if (row != null) Motion.press(row);
        }

        tap(root, R.id.lytAbout, x -> PageActivity.open(requireContext(), "about"));
        tap(root, R.id.lytAdsPrivacy, x -> Ads.showPrivacyOptions(getActivity()));
        tap(root, R.id.lytPrivacy, x -> PageActivity.open(requireContext(), "privacy"));
        tap(root, R.id.lytPages, x -> PageActivity.open(requireContext(), "hub"));
        tap(root, R.id.lytHelp, x -> PageActivity.open(requireContext(), "help"));
        tap(root, R.id.lytContact, x -> PageActivity.open(requireContext(), "contact"));
        tap(root, R.id.lytTerms, x -> PageActivity.open(requireContext(), "terms"));
        tap(root, R.id.lytCheckUpdate, x -> {
            Activity a = getActivity();
            if (a != null) AppUpdate.checkNow(a);
        });
        tap(root, R.id.lytShareApp, x -> {
            try {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, "Watch on CineAmit " + CineAmitApp.baseUrl());
                startActivity(Intent.createChooser(i, getString(R.string.share_app)));
            } catch (Exception ignored) {}
        });
        tap(root, R.id.lytPinSet, x -> {
            Activity a = getActivity();
            if (a == null) return;
            if (DlVault.hasPin()) {
                DlVault.change(a, () -> { DlVault.lock(); paintPin(); });
            } else {
                DlVault.setup(a, () -> { DlVault.lock(); paintPin(); });
            }
        });
        tap(root, R.id.lytPinReset, x -> {
            Activity a = getActivity();
            if (a == null) return;
            if (!DlVault.hasPin()) {
                Toast.makeText(a, "Set a PIN first", Toast.LENGTH_SHORT).show();
                return;
            }
            DlVault.forgot(a, () -> { DlVault.lock(); paintPin(); });
        });

        SwitchCompat sw = root.findViewById(R.id.switch_notification);
        if (sw != null) {
            sw.setChecked(CineAmitApp.prefs().getBoolean("push_on", true));
            sw.setOnCheckedChangeListener((b, on) ->
                    CineAmitApp.prefs().edit().putBoolean("push_on", on).apply());
        }

        TextView ver = root.findViewById(R.id.settingsVersion);
        if (ver != null) ver.setText("CineAmit  " + BuildConfig.VERSION_NAME);
        paintPin();
        return root;
    }

    @Override
    public void onResume() {
        super.onResume();
        paintPin();
    }

    private void paintPin() {
        if (root == null) return;
        boolean has = DlVault.hasPin();
        TextView title = root.findViewById(R.id.pinSetTitle);
        TextView sub = root.findViewById(R.id.pinSetSub);
        if (title != null) title.setText(has ? "Change PIN" : "Set PIN");
        if (sub != null) sub.setText(has ? "Enter current PIN, then a new PIN" : "4-digit PIN for private downloads");
        View reset = root.findViewById(R.id.lytPinReset);
        View div = root.findViewById(R.id.pinResetDivider);
        int vis = has ? View.VISIBLE : View.GONE;
        if (reset != null) reset.setVisibility(vis);
        if (div != null) div.setVisibility(vis);
        TextView resetSub = root.findViewById(R.id.pinResetSub);
        if (resetSub != null) resetSub.setText("New PIN via email OTP");
    }

    private void tap(View v, int id, View.OnClickListener l) {
        View row = v.findViewById(id);
        if (row != null) row.setOnClickListener(l);
    }
}
