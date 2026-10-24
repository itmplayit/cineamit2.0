'use strict';

// express-mysql-session 3.0.3 schedules a promise-returning cleanup with
// setInterval and does not consume its rejection. A reset during that DELETE
// can therefore terminate Node despite an otherwise successful startup.
module.exports = function createSessionStore(session) {
  const MySQLStore = require('express-mysql-session')(session);
  return class ResilientMySQLStore extends MySQLStore {
    setExpirationInterval(interval) {
      this.clearExpirationInterval();
      if (this._cleanupClosed) return;
      const generation = this._cleanupGeneration;
      const requested = Number(interval || this.options.checkExpirationInterval);
      const normalDelay = Number.isFinite(requested) && requested >= 1 && requested <= 2147483647 ? Math.floor(requested) : 900000;
      let failures = 0;
      const active = () => this._cleanupGeneration === generation;
      const schedule = delay => {
        if (!active()) return;
        this._expirationInterval = setTimeout(() => {
          // Consume BOTH a synchronous exception and a rejected promise. Only
          // scheduled expiration cleanup is contained; get/set/touch and manual
          // clearExpiredSessions calls keep their original failure semantics.
          Promise.resolve().then(() => this.clearExpiredSessions()).then(
            () => { failures = 0; schedule(normalDelay); },
            error => {
              if (!active()) return;
              failures = Math.min(5, failures + 1);
              const delay = Math.min(normalDelay, 60000 * 2 ** (failures - 1));
              const raw = String(error && error.code || 'UNAVAILABLE');
              const code = /^[A-Z0-9_]{1,64}$/.test(raw) ? raw : 'UNAVAILABLE';
              console.error('[session-cleanup] Expired-session cleanup failed (' + code + '); retry in ' + delay + 'ms. Active session operations still require the DB.');
              schedule(delay);
            }
          ).catch(() => {
            // A scheduler/logging fault must not become a second unhandled
            // rejection. Stop this timer; do not install a process-wide handler.
            if (active()) this.clearExpirationInterval();
            try { console.error('[session-cleanup] Cleanup scheduler stopped unexpectedly; inspect logs and restart the worker.'); } catch {}
          });
        }, delay);
        // The web listener, not this maintenance timer, owns process lifetime.
        if (this._expirationInterval && this._expirationInterval.unref) this._expirationInterval.unref();
      };
      schedule(normalDelay);
    }

    close(...args) {
      this._cleanupClosed = true;
      this.clearExpirationInterval();
      return super.close(...args);
    }

    clearExpirationInterval() {
      this._cleanupGeneration = Number(this._cleanupGeneration || 0) + 1;
      clearTimeout(this._expirationInterval);
      this._expirationInterval = null;
      // Generation invalidation also prevents an in-flight cleanup from
      // scheduling another timer after close() or interval replacement.
    }
  };
};
