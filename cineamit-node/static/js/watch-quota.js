'use strict';
(function () {
  function init() {
    const label = document.getElementById('watchQuotaSummary');
    const wrapper = document.getElementById('playerWrapper');
    if (!label || !wrapper || label.dataset.watchQuotaReady) return;
    label.dataset.watchQuotaReady = '1';
    const url = new URL(label.dataset.quotaUrl, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== '/api/watch/quota') return;
    const panel = document.getElementById('watchQuotaPanel');
    const heading = document.getElementById('watchQuotaHeading');
    const message = document.getElementById('watchQuotaMessage');
    const playerReady = label.dataset.playerReady === '1';
    const seen = new WeakSet();
    let active = true, pending = false, queued = false, timer = 0, controller = null, generation = 0;
    let frameGeneration = 0, admitted = false;
    function schedule(delay = 30000) { clearTimeout(timer); if (active) timer = setTimeout(refresh, delay); }
    async function refresh() {
      if (!active || document.hidden) { schedule(); return; }
      if (pending) { queued = true; return; }
      pending = true;
      const operation = generation, frame = frameGeneration;
      const requestController = new AbortController();
      controller = requestController;
      const timeout = setTimeout(() => requestController.abort(), 8000);
      try {
        const response = await fetch(url.href, {credentials:'same-origin',cache:'no-store',signal:requestController.signal,headers:{Accept:'application/json'}});
        if (!response.ok) throw new Error('Usage unavailable');
        const data = await response.json();
        const q = data && data.quota;
        if (!data.ok || !q || q.available !== true || typeof q.summary !== 'string' || typeof q.blocked !== 'boolean' || !Number.isFinite(q.reset_at) || !Number.isFinite(q.server_now)) throw new Error('Invalid usage');
        if (!active || operation !== generation) return;
        // A replacement may have been admitted after this request's snapshot.
        if (frame !== frameGeneration) { queued = true; return; }
        label.textContent = q.summary;
        label.title = String(q.detail || 'Reset: 12 AM IST.');
        label.dataset.state = q.exempt ? 'exempt' : q.blocked ? 'blocked' : 'ready';
        if (q.current_unlocked || q.exempt || !q.enabled || q.daily_max === 0) admitted = true;
        // Status refresh must not interrupt an already admitted continuous stream.
        const blocked = q.blocked && !admitted;
        if (panel) panel.hidden = !blocked && playerReady;
        if (!blocked && !playerReady) {
          if (heading) heading.textContent = 'Access available — reload to start';
          if (message) message.textContent = 'Usage check is available again. Press Retry / reload to generate fresh player links.';
        }
        if (blocked) {
          if (heading) heading.textContent = 'No new unlocks left today';
          if (message) message.textContent = q.message || 'Same-day unlocked titles can still be replayed. New unlocks reset at 12 AM IST.';
        }
        schedule(Math.max(1000, Math.min(30000, q.reset_at - q.server_now + 100)));
      } catch {
        if (active && operation === generation) {
          label.textContent = 'Watch usage unavailable — retrying';
          label.title = 'Do not assume zero usage. New player requests still require the server quota check.';
          label.dataset.state = 'unavailable';
          schedule();
        }
      } finally {
        clearTimeout(timeout);
        if (operation === generation) {
          controller = null; pending = false;
          if (queued && active) { queued = false; refresh(); }
        }
      }
    }
    function bindFrame() {
      const frame = document.getElementById('videoPlayer');
      if (!frame || seen.has(frame)) return;
      seen.add(frame); ++frameGeneration; admitted = false;
      frame.addEventListener('load', refresh);
      refresh();
    }
    const observer = new MutationObserver(bindFrame);
    observer.observe(wrapper, {childList:true});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('focus', refresh);
    window.addEventListener('pagehide', () => {
      active = false; ++generation; clearTimeout(timer);
      if (controller) controller.abort();
      pending = false; queued = false; controller = null;
    });
    window.addEventListener('pageshow', () => { active = true; refresh(); });
    bindFrame();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
