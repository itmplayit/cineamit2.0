/* Confirmed cosmetic filtering only; never infer a blocker/VPN from failed ad/network requests. */
(function () {
  'use strict';
  if (window.CineAccess) return;
  var path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (['/privacy','/privacy-policy','/terms','/legal','/dmca','/setup'].indexOf(path) !== -1) return;
  if (path === '/about' && /^(privacy|terms|legal)$/.test(new URLSearchParams(location.search).get('kind') || '')) return;
  // Embedded third-party documents are not the site's top-level access boundary.
  if (window.top !== window.self) return;
  var blocked = false, running = false, wall = null, status = null, retry = null;
  var probes = document.createElement('div'); probes.id = 'cine-access-probes';
  probes.setAttribute('aria-hidden', 'true');
  function probe(name) {
    var el = document.createElement('div'); el.className = name;
    el.style.cssText = 'position:fixed;left:-12000px;top:1px;width:13px;height:13px;display:block;visibility:visible;opacity:1;pointer-events:none;';
    probes.appendChild(el); return el;
  }
  var control = probe('cine-layout-control'), a = probe('adsbox'), b = probe('ad-banner');
  function visible(el) {
    if (!el.isConnected) return false;
    var s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && s.visibility !== 'collapse'
      && Number(s.opacity) !== 0 && r.width > 0 && r.height > 0;
  }
  function sample() {
    // A hidden/unpainted control makes the result UNKNOWN, not blocked.
    if (window.matchMedia && window.matchMedia('print').matches) return 'unknown';
    if (!visible(control)) return 'unknown';
    var x = visible(a), y = visible(b);
    return !x && !y ? 'filtered' : x && y ? 'clear' : 'unknown';
  }
  function stopMedia(root) {
    if (root.tagName === 'IFRAME') { root.src = 'about:blank'; root.remove(); return; }
    if (root.tagName === 'VIDEO' || root.tagName === 'AUDIO') { try { root.pause(); } catch (_) {} }
    root.querySelectorAll('video,audio').forEach(function (v) { try { v.pause(); } catch (_) {} });
    root.querySelectorAll('iframe').forEach(function (f) { f.src = 'about:blank'; f.remove(); });
  }
  function lockContent() {
    Array.from(document.body.children).forEach(function (el) {
      if (el === probes || el === wall || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
      el.inert = true; el.setAttribute('aria-hidden', 'true'); stopMedia(el);
    });
  }
  function showWall() {
    if (blocked) return;
    blocked = true;
    wall = document.createElement('section'); wall.id = 'cine-access-wall';
    wall.setAttribute('role', 'alertdialog'); wall.setAttribute('aria-modal','true');
    wall.setAttribute('aria-labelledby','cine-access-title');
    wall.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0c0913;color:#fff;display:flex;align-items:center;justify-content:center;overflow:auto;padding:24px;box-sizing:border-box;';
    wall.innerHTML = '<div class="cine-access-card"><p class="cine-access-brand">CINEAMIT · ACCESS CHECK</p>'
      + '<div class="cine-access-badge" aria-hidden="true">!</div><h1 id="cine-access-title">Disable your ad blocker</h1>'
      + '<p>Ad-related page elements are being filtered. Allow CineAmit in your ad blocker, then check again to continue.</p>'
      + '<p class="cine-access-note">We do not block you just because an ad fails or your connection is slow. This screen requires repeated filtering of two separate test elements while a normal element remains visible.</p>'
      + '<button type="button" id="cine-access-retry">I have disabled it · Check again</button>'
      + '<p id="cine-access-status" role="status" aria-live="polite"></p><a href="/privacy">Privacy policy</a>'
      + '<p class="cine-access-note">Browser VPN detection is not enabled. No IP-reputation service is used.</p></div>';
    document.documentElement.classList.add('cine-access-blocked');
    document.body.appendChild(wall); lockContent();
    retry = wall.querySelector('#cine-access-retry'); status = wall.querySelector('#cine-access-status');
    retry.addEventListener('click',function () { check(true); }); retry.focus();
    wall.addEventListener('keydown',function (event) {
      if (event.key === 'Escape') { event.preventDefault(); return; }
      if (event.key !== 'Tab') return;
      var items = wall.querySelectorAll('button,a'), first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    new MutationObserver(function () { if (blocked) lockContent(); }).observe(document.body,{childList:true,subtree:true});
    document.dispatchEvent(new CustomEvent('cine:access-blocked'));
  }
  function check(isRetry) {
    if (running || document.hidden) return;
    running = true;
    if (isRetry && retry) { retry.disabled = true; status.textContent = 'Checking…'; }
    var count = 0, filtered = 0, clear = 0;
    function step() {
      if (document.hidden) { done(); return; }
      var result = sample(); count++;
      if (result === 'filtered') filtered++; else if (result === 'clear') clear++;
      if (count < 3) { setTimeout(step,300); return; }
      if (filtered === 3) {
        showWall();
        if (status) status.textContent = 'Filtering is still detected. Disable the blocker for this site and try again.';
      } else if (isRetry && blocked && clear === 3) {
        // Reload restores frames/media and normal accessibility state, not a hidden half-running page.
        location.reload();
      } else if (isRetry && status) status.textContent = 'Could not confirm that filtering is off. Check your blocker settings and try again.';
      done();
    }
    function done() { running = false; if (retry) retry.disabled = false; }
    step();
  }
  window.CineAccess = Object.freeze({isBlocked:function () { return blocked; },checkAgain:function () { check(true); }});
  function start() {
    document.body.appendChild(probes); check(false);
    setInterval(function () { if (!blocked) check(false); },2500);
    document.addEventListener('visibilitychange',function () { if (!document.hidden && !blocked) check(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
}());
