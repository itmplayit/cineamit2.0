package in.cineamit.app.ui;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.ConcatAdapter;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import in.cineamit.app.R;

/** Grid footer: auto-loads next page when visible; pill still tappable. */
public final class LoadMoreFooter extends RecyclerView.Adapter<LoadMoreFooter.VH> {
    private boolean show;
    private boolean loading;
    private boolean armed;
    private final Runnable onClick;
    private RecyclerView host;

    public LoadMoreFooter(Runnable onClick) {
        this.onClick = onClick;
        setHasStableIds(true);
    }

    public static ConcatAdapter attach(RecyclerView list, RecyclerView.Adapter<?> data, LoadMoreFooter foot, int span) {
        ConcatAdapter concat = new ConcatAdapter(data, foot);
        RecyclerView.LayoutManager raw = list.getLayoutManager();
        if (raw instanceof GridLayoutManager) {
            GridLayoutManager glm = (GridLayoutManager) raw;
            glm.setSpanSizeLookup(new GridLayoutManager.SpanSizeLookup() {
                @Override
                public int getSpanSize(int position) {
                    return position >= data.getItemCount() ? Math.max(1, span) : 1;
                }
            });
        }
        foot.bindHost(list);
        list.setAdapter(concat);
        return concat;
    }

    private void bindHost(RecyclerView list) {
        if (list == null) return;
        Object prev = list.getTag(R.id.tag_load_more);
        if (prev instanceof RecyclerView.OnScrollListener) {
            list.removeOnScrollListener((RecyclerView.OnScrollListener) prev);
        }
        host = list;
        RecyclerView.OnScrollListener sl = new RecyclerView.OnScrollListener() {
            @Override
            public void onScrolled(@NonNull RecyclerView rv, int dx, int dy) {
                tryAuto();
            }
        };
        list.setTag(R.id.tag_load_more, sl);
        list.addOnScrollListener(sl);
    }

    private void tryAuto() {
        if (loading || !show || onClick == null || armed) return;
        if (!footerVisible()) return;
        armed = true;
        onClick.run();
    }

    private boolean footerVisible() {
        if (host == null) return false;
        RecyclerView.LayoutManager lm = host.getLayoutManager();
        if (!(lm instanceof LinearLayoutManager)) return false;
        int last = ((LinearLayoutManager) lm).findLastVisibleItemPosition();
        int n = lm.getItemCount();
        return n > 0 && last >= n - 1;
    }

    @Override
    public long getItemId(int position) {
        return 7L;
    }

    public void idle(boolean hasMore) {
        armed = false;
        set(hasMore, false);
        if (hasMore && host != null) host.post(this::tryAuto);
    }

    public void loading() {
        set(true, true);
    }

    public void hide() {
        armed = false;
        set(false, false);
    }

    private void set(boolean show, boolean loading) {
        boolean same = this.show == show && this.loading == loading;
        boolean was = this.show;
        this.show = show;
        this.loading = loading;
        if (same) return;
        if (was && show) notifyItemChanged(0);
        else if (!was && show) notifyItemInserted(0);
        else if (was) notifyItemRemoved(0);
    }

    @Override
    public int getItemCount() {
        return show ? 1 : 0;
    }

    @NonNull
    @Override
    public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.view_load_more, parent, false);
        ViewGroup.LayoutParams lp = v.getLayoutParams();
        if (lp != null) {
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            v.setLayoutParams(lp);
        }
        return new VH(v);
    }

    @Override
    public void onBindViewHolder(@NonNull VH h, int position) {
        h.bind(loading, v -> {
            if (!loading && onClick != null && !armed) {
                armed = true;
                onClick.run();
            }
        });
        if (!loading && show) h.itemView.post(this::tryAuto);
    }

    static final class VH extends RecyclerView.ViewHolder {
        VH(View v) {
            super(v);
        }

        void bind(boolean loading, View.OnClickListener click) {
            View spin = itemView.findViewById(R.id.loadMoreSpin);
            TextView t = itemView.findViewById(R.id.loadMoreText);
            if (spin != null) spin.setVisibility(loading ? View.VISIBLE : View.GONE);
            if (t != null) t.setText(loading ? "Loading…" : "Load more");
            itemView.setEnabled(!loading);
            itemView.setAlpha(loading ? 0.82f : 1f);
            itemView.setOnClickListener(loading ? null : click);
            Motion.press(itemView);
        }
    }
}
