(() => {
  'use strict';
  const form = document.querySelector('form[action="/admin/update_app_economy"]');
  const button = document.getElementById('adsPreviewButton');
  const output = document.getElementById('adsPreviewOutput');
  if (!form || !button || !output) return;
  let revision = 0;
  function note(message) { output.replaceChildren(); const p = document.createElement('p'); p.textContent = message; output.append(p); }
  form.addEventListener('input', () => { revision++; note('Values changed. Preview again to refresh the calculation and before → after comparison. Nothing has been saved by preview.'); });
  form.addEventListener('change', () => { revision++; note('Values changed. Preview again to refresh the calculation and before → after comparison. Nothing has been saved by preview.'); });
  button.addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    const current = revision;
    button.disabled = true;
    note('Reading current settings and validating your proposed values…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/admin/preview_app_economy', {method: 'POST', credentials: 'same-origin',
        headers: {'Accept': 'application/json'}, body: new URLSearchParams(new FormData(form)), signal: controller.signal});
      const data = await response.json();
      if (current !== revision) return;
      if (response.status === 409 && data.error === 'settings_conflict') { note('Settings changed in another tab or by another admin. Reload the page and review current values before previewing or saving. Nothing was saved.'); return; }
      if (!response.ok || !data.ok || !data.preview || data.preview.read_only !== true) throw new Error('Preview unavailable');
      const p = data.preview;
      output.replaceChildren();
      const line = (text, cls) => { const el = document.createElement('p'); el.textContent = text; if (cls) el.className = cls; output.append(el); };
      line('Read-only preview — no settings or audit records saved. Snapshot: ' + p.read_at);
      line(p.points_per_reward + ' points / verified reward · Daily cap: ' + (p.daily_cap === 0 ? 'Unlimited' : p.daily_cap + ' points') + ' · Reward slots / UTC day: ' + (p.rewards_per_day === null ? 'No daily cap' : p.rewards_per_day) + ' · Admitted-attempt cooldown: ' + p.cooldown_seconds + ' seconds.');
      if (!p.earning_enabled) line('Earning is disabled by a proposed master/rewarded switch. The calculations below are hypothetical.', 'ads-warning');
      if (!p.verification_configured) line('Unity S2S verification is not configured/enabled. Calculations do not enable rewards.', 'ads-warning');
      for (const plan of p.plans) {
        const days = plan.minimum_days === null ? 'No cap-based day estimate' : plan.minimum_days + ' active earning day(s), cap-only theoretical minimum';
        line(plan.name + (plan.enabled ? '' : ' [disabled]') + ': ' + plan.cost + ' points → ' + plan.rewards + ' verified rewards from a zero balance; ' + days + '.');
      }
      line('Cap-only math: assumes full verified payouts and starting from zero; cooldown can increase the real time required. Does not guarantee ad fill, completion, callback timing or earnings. Trial eligibility/duration are not changed by this calculation.', 'ads-muted');
      const wrap = document.createElement('div'); wrap.className = 'ads-table-wrap';
      const table = document.createElement('table'); table.className = 'ads-table';
      const head = document.createElement('thead'); const hrow = document.createElement('tr');
      for (const text of ['Setting', 'Before', 'Proposed']) { const cell = document.createElement('th'); cell.textContent = text; hrow.append(cell); }
      head.append(hrow); table.append(head);
      const body = document.createElement('tbody');
      for (const change of p.changes) {
        const row = document.createElement('tr');
        for (const value of [change.key, change.before, change.after]) { const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell); }
        body.append(row);
      }
      table.append(body); wrap.append(table);
      if (p.changes.length) output.append(wrap); else line('No effective changes.');
      line('Preview is not a reservation. Save revalidates and checks the page revision; another admin’s intervening Save requires a reload. Actual changes are recorded in history.');
    } catch (error) {
      if (current === revision) note('Preview unavailable. Check values, your session/CSRF token, rate limits or database availability, then retry. Nothing was saved by this preview.');
    } finally { clearTimeout(timer); button.disabled = false; }
  });
})();
