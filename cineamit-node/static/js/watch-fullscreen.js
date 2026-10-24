'use strict';
// Website-owned control: do not inspect/inject cross-origin player documents or
// accept postMessage commands that could request fullscreen without a user click.
(function () {
  function init() {
    const wrapper = document.getElementById('playerWrapper');
    const button = document.getElementById('playerFullscreenButton');
    const status = document.getElementById('playerFullscreenStatus');
    if (!wrapper || !button || wrapper.dataset.fullscreenControl === 'ready') return;
    wrapper.dataset.fullscreenControl = 'ready';
    let expanded = false, ancestors = [], priorFocus = null, scroll = null;
    let hadRootClass = false, busy = false, generation = 0;
    const root = document.documentElement;
    const current = () => document.fullscreenElement || document.webkitFullscreenElement;
    const owns = () => !!current() && (current() === wrapper || wrapper.contains(current()));
    function message(text) { if (status) status.textContent = text; }
    function sync() {
      const active = expanded || owns();
      button.textContent = expanded ? 'Exit expanded view' : active ? 'Exit fullscreen' : 'Fullscreen';
      button.setAttribute('aria-label', button.textContent);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.disabled = busy;
    }
    function leaveExpanded(restoreFocus = true) {
      if (!expanded) return;
      expanded = false;
      wrapper.classList.remove('cine-player-expanded');
      if (!hadRootClass) root.classList.remove('cine-player-expanded');
      ancestors.forEach(node => node.classList.remove('cine-player-expanded-ancestor'));
      ancestors = [];
      if (scroll) {
        try { window.scrollTo({left: scroll.x, top: scroll.y, behavior: 'instant'}); }
        catch { window.scrollTo(scroll.x, scroll.y); }
      }
      scroll = null;
      if (restoreFocus && priorFocus && priorFocus.isConnected && priorFocus.focus) {
        try { priorFocus.focus({preventScroll: true}); } catch { priorFocus.focus(); }
      }
      priorFocus = null;
      message('');
      sync();
    }
    function enterExpanded() {
      if (expanded || !wrapper.parentNode) return;
      scroll = {x: window.scrollX, y: window.scrollY};
      priorFocus = document.activeElement;
      hadRootClass = root.classList.contains('cine-player-expanded');
      // Keep the iframe in its existing DOM position: ordinary reparenting can
      // reload a cross-origin browsing context and interrupt playback.
      for (let node = wrapper.parentElement; node; node = node.parentElement) {
        if (!node.classList.contains('cine-player-expanded-ancestor')) {
          node.classList.add('cine-player-expanded-ancestor');
          ancestors.push(node);
        }
      }
      expanded = true;
      root.classList.add('cine-player-expanded');
      wrapper.classList.add('cine-player-expanded');
      message('Browser fullscreen unavailable. Expanded view only; use Exit expanded view to return.');
      sync();
    }
    button.addEventListener('click', async () => {
      if (busy) return;
      if (expanded) { leaveExpanded(); return; }
      busy = true;
      const operation = ++generation;
      sync();
      try {
        if (owns()) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (!exit) { message('Use the browser or player fullscreen-exit control.'); return; }
          await exit.call(document);
          if (operation === generation) message('');
        } else {
          const request = wrapper.requestFullscreen || wrapper.webkitRequestFullscreen;
          if (!request) { enterExpanded(); return; }
          // Invoke directly inside the click handler, before any asynchronous work.
          try {
            await request.call(wrapper);
            if (operation === generation) message('');
          } catch {
            if (operation === generation) enterExpanded();
          }
        }
      } catch {
        if (operation === generation) message('Could not exit fullscreen. Use the browser or player exit control.');
      } finally {
        if (operation === generation) {
          busy = false; sync();
          if (expanded) { try { button.focus({preventScroll: true}); } catch { button.focus(); } }
        }
      }
    });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(name => document.addEventListener(name, () => {
      if (owns() && expanded) leaveExpanded(false);
      sync();
    }));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && expanded) { event.preventDefault(); leaveExpanded(); }
    });
    window.addEventListener('pagehide', () => {
      ++generation;
      busy = false;
      leaveExpanded(false);
      sync();
    });
    button.hidden = false;
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
