'use strict';

const fs = require('fs');
const path = require('path');
const { add } = require('../../../core/router');
const TMDB = require('../../../services/tmdb');
const SiteStatus = require('../../../services/site-status');
const { requireStaff } = require('../home-bundle');

// Shared admin helpers (moved verbatim from registerAdmin() in the old routes/admin.js).
const staff = ['owner', 'super_admin', 'editor'];
const owners = ['owner', 'super_admin'];

const postAdmin = (p, n, fn, roles = staff) => add(p, n, async (app, args) => {
  if (!(await requireStaff(app, roles))) return;
  return fn(app, args);
}, ['POST']);


async function updateSiteStatus(app, key, field, label) {
  if (!(await requireStaff(app, owners))) return;
  app.res.set('Cache-Control', 'private, no-store');
  let enabled;
  try {
    enabled = SiteStatus.submittedFlag(app.req.body, field);
  } catch (error) {
    if (app.wantsJson()) {
      app.res.status(400);
      return app.json({ ok: false, error: 'invalid_setting', message: error.message });
    }
    app.flash(label + ' was not changed. ' + error.message, 'error');
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-settings');
  }
  try {
    await Database.execute(
      'INSERT INTO site_setting (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      [key, enabled ? 'true' : 'false']
    );
  } catch (error) {
    console.error('[Admin:site-status] Could not save ' + key + ': ' + error.message);
    if (app.wantsJson()) {
      app.res.status(503);
      return app.json({ ok: false, error: 'setting_unavailable', message: 'Could not save site status. Please retry.' });
    }
    app.flash('Could not save ' + label.toLowerCase() + '. Please retry; no successful update was confirmed.', 'error');
    return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-settings');
  }
  const message = label + ' is now ' + (enabled ? 'ON' : 'OFF') + '.';
  if (app.wantsJson()) return app.json({ ok: true, enabled, message });
  app.flash(message, 'success');
  return app.redirect(app.urlFor('routes.admin_dashboard') + '#tab-settings');
}

function bustSiteCache() {
  try {
    const dir = TMDB.cacheDir();
    for (const f of ['site_settings_v6.json', 'site_settings_v7.json']) {
      try { fs.unlinkSync(path.join(dir, f)); } catch {}
    }
  } catch {}
}


module.exports = { staff, owners, postAdmin, updateSiteStatus, bustSiteCache };
