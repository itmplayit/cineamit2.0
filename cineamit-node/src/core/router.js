'use strict';

const App = require('./app');
const TMDB = require('../services/tmdb');

const routes = { GET: [], POST: [], PUT: [], DELETE: [], PATCH: [] };

function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = escaped.replace(/\\\{(\w+)(?::(\w+))?\\\}/g, (_, name, type) => {
    const sub = type === 'int' ? '\\d+' : '[^/]+';
    return `(?<${name}>${sub})`;
  });
  return new RegExp('^' + regex + '$');
}

function add(pattern, endpoint, handler, methods = ['GET']) {
  App.endpoints[endpoint] = pattern;
  const compiled = { pattern, endpoint, handler, regex: patternToRegex(pattern) };
  for (const m of methods) {
    const key = String(m).toUpperCase();
    if (!routes[key]) routes[key] = [];
    routes[key].push(compiled);
  }
}

function match(method, path) {
  let m = String(method).toUpperCase();
  if (m === 'HEAD') m = 'GET';
  for (const route of (routes[m] || [])) {
    const found = path.match(route.regex);
    if (found) {
      return { handler: (app,args)=>TMDB.withRequestContext(()=>route.handler(app,args),{blacklist:app._requestBlacklist}), endpoint: route.endpoint, args: found.groups || {} };
    }
  }
  return null;
}

module.exports = { add, match, routes };
