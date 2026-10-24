'use strict';

// Auth guards for JSON API handlers.
async function requireAppUser(app) {
    const user = await app.currentUser();
    if (!user) {
      app.res.status(401);
      app.json({ ok: false, error: 'login' });
      return null;
    }
    return user;
  }


async function needAppUser(app) {
  if (!(await app.isAuthenticated())) {
    app.res.status(401);
    app.json({ ok: false, error: 'login_required' });
    return null;
  }
  return app.currentUser();
}

module.exports = { requireAppUser, needAppUser };
