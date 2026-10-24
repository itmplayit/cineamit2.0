package in.cineamit.app.ui;

import android.app.AlertDialog;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import in.cineamit.app.Io;
import in.cineamit.app.MainActivity;
import in.cineamit.app.R;
import in.cineamit.app.data.Api;
import in.cineamit.app.data.Models.AppUser;
import in.cineamit.app.data.Models.MediaItem;
import in.cineamit.app.data.Models.Session;

public class WatchlistFragment extends Fragment {
    private PosterAdapter adapter;
    private View root;
    private boolean skipResume;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        root = inflater.inflate(R.layout.fragment_watchlist, container, false);
        Ui.padTopInset(root.findViewById(R.id.cineHeaderTop));
        Motion.page(root);
        RecyclerView grid = root.findViewById(R.id.recyclerView);
        grid.setLayoutManager(Ui.posterGrid(requireContext()));
        Ui.padForIsland(grid);
        adapter = new PosterAdapter(item -> MainActivity.openDetails(requireContext(), item.media_type, item.id), true);
        adapter.setOnRemove(this::confirmRemove);
        grid.setAdapter(adapter);
        View loginBtn = root.findViewById(R.id.btnLogin);
        if (loginBtn != null) loginBtn.setOnClickListener(v ->
                in.cineamit.app.LoginActivity.open(requireContext()));
        skipResume = true;
        reload();
        return root;
    }

    private void confirmRemove(MediaItem item) {
        if (item == null || getContext() == null) return;
        new AlertDialog.Builder(requireContext())
                .setTitle("Remove from watchlist")
                .setMessage("“" + item.title + "” hatao?")
                .setPositiveButton("Remove", (d, w) -> Io.run(this, () -> Api.watchlistToggle(item.media_type, item.id), json -> {
                    if (json.optBoolean("ok", false) || "login_required".equals(json.optString("error"))) reload();
                    else Toast.makeText(requireContext(), "Could not remove", Toast.LENGTH_SHORT).show();
                }, e -> Toast.makeText(requireContext(), "Remove fail", Toast.LENGTH_SHORT).show()))
                .setNegativeButton("Cancel", null)
                .show();
    }

    public void reload() {
        if (root == null) return;
        AppUser user = Session.user;
        View login = root.findViewById(R.id.lytLogin);
        View empty = root.findViewById(R.id.lyt_not_found);
        View progress = root.findViewById(R.id.progressBar);
        RecyclerView grid = root.findViewById(R.id.recyclerView);
        if (user == null) {
            if (progress != null) progress.setVisibility(View.GONE);
            if (empty != null) empty.setVisibility(View.GONE);
            if (login != null) login.setVisibility(View.VISIBLE);
            adapter.setItems(null);
            return;
        }
        if (login != null) login.setVisibility(View.GONE);
        if (empty != null) empty.setVisibility(View.GONE);
        if (progress != null) progress.setVisibility(View.VISIBLE);
        Io.run(this, Api::watchlist, json -> {
            if (progress != null) progress.setVisibility(View.GONE);
            if ("login_required".equals(json.optString("error"))) {
                if (login != null) login.setVisibility(View.VISIBLE);
                return;
            }
            Api.applyMeta(json);
            adapter.setItems(Api.parseItems(json.optJSONArray("items")));
            if (adapter.getItemCount() == 0 && empty != null) empty.setVisibility(View.VISIBLE);
            if (grid != null) grid.setVisibility(adapter.getItemCount() == 0 ? View.GONE : View.VISIBLE);
        }, e -> {
            if (progress != null) progress.setVisibility(View.GONE);
            if (empty != null) empty.setVisibility(View.VISIBLE);
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        if (skipResume) {
            skipResume = false;
            return;
        }
        reload();
    }
}
