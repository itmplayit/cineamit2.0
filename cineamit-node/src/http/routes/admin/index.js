'use strict';

// Admin route registrar orchestrator (moved verbatim from routes/admin.js registerAdmin).
const { registerAdminDashboard } = require('./dashboard');
const { registerAdminUsers } = require('./users');
const { registerAdminSources } = require('./sources');
const { registerAdminContent } = require('./content');
const { registerAdminEconomy } = require('./economy');

function registerAdmin() {
  registerAdminDashboard();
  registerAdminUsers();
  registerAdminSources();
  registerAdminContent();
  registerAdminEconomy();
}

module.exports = { registerAdmin };
