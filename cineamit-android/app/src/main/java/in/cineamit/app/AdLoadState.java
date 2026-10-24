package in.cineamit.app;

/** Main-thread state for one ad format. No Android dependency; stale callbacks are ignored. */
final class AdLoadState {
    static final int MAX_FAILURES = 5;
    static final long COOLDOWN_MS = 300_000L;
    static final long MAX_AGE_MS = 50 * 60_000L;
    private int generation;
    private boolean loading;
    private int failures;
    private long nextTryAt;
    private long loadedAt = -1;

    int begin(long now) {
        if (loading || now < nextTryAt) return 0;
        if (failures >= MAX_FAILURES) failures = 0; // Only a later foreground action resumes a new burst.
        loading = true;
        loadedAt = -1;
        return ++generation;
    }

    boolean accepts(int token) { return loading && token == generation; }

    boolean loaded(int token, long now) {
        if (!loading || token != generation) return false;
        loading = false;
        failures = 0;
        nextTryAt = 0;
        loadedAt = now;
        return true;
    }

    boolean failed(int token, long now) {
        if (!loading || token != generation) return false;
        loading = false;
        failures++;
        nextTryAt = now + (failures >= MAX_FAILURES ? COOLDOWN_MS : Math.min(60_000L, 5_000L << (failures - 1)));
        return true;
    }

    long retryDelay(long now) {
        return failures > 0 && failures < MAX_FAILURES ? Math.max(0, nextTryAt - now) : -1;
    }

    boolean expired(long now) {
        return loadedAt < 0 || now - loadedAt >= MAX_AGE_MS;
    }

    boolean cooling(long now) { return !loading && now < nextTryAt; }

    void reset() {
        generation++;
        loading = false;
        failures = 0;
        nextTryAt = 0;
        loadedAt = -1;
    }
}
