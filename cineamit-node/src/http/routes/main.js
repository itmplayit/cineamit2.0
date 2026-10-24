'use strict';

// Main route registrar: orchestrates category registrars (kept as the stable entry point
// for server.js and for web-json's lazy require('./main').loadHomeBundle).
const { registerAdmin } = require('./admin');
const { registerLivetvRoutes } = require('./livetv');
const { registerCatalogRoutes } = require('./catalog');
const { registerMediaRoutes } = require('./media');
const { registerLibraryRoutes } = require('./library');
const { registerAccountRoutes } = require('./account');
const { registerApiPublicRoutes } = require('./api-public');
const { registerPagesRoutes } = require('./pages');
const { loadHomeBundle } = require('./home-bundle');

module.exports = function registerMain() {
  registerLivetvRoutes();
  registerCatalogRoutes();
  registerMediaRoutes();
  registerLibraryRoutes();
  registerAccountRoutes();
  registerApiPublicRoutes();
  registerPagesRoutes();
  registerAdmin();
};

module.exports.loadHomeBundle = loadHomeBundle;
