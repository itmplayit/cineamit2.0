'use strict';

/**
 * Twing adapter so the original PHP Twig templates run unchanged.
 * npm `twig` cannot parse Flask-style named args (url_for(..., media_type=...))
 * or the Elvis operator `?:`. Twing 7 can, once url_for/json_str/constant/session.get
 * are registered.
 */

const fs = require('fs');
const path = require('path');
const twing = require('twing');

const URL_FOR_NAMED = [
  'media_type', 'tmdb_id', 'title', 'slug', 'provider_id', 'profile_id',
  'id', 'notif_id', 'playlist_id', 'person_id', 'filename', 'name', '_external',
];

const PHP_CONSTANTS = {
  JSON_HEX_TAG: 1,
  JSON_HEX_AMP: 2,
  JSON_HEX_APOS: 4,
  JSON_HEX_QUOT: 8,
  JSON_UNESCAPED_SLASHES: 64,
  JSON_UNESCAPED_UNICODE: 256,
  JSON_FORCE_OBJECT: 16,
  JSON_NUMERIC_CHECK: 32,
  JSON_PRETTY_PRINT: 128,
};

let currentApp = null;
let envSingleton = null;
let templatesDirCached = null;

class SessionBag {
  constructor(session) {
    this._s = session || {};
    for (const k of Object.keys(this._s)) {
      if (k === 'get' || k === '_s') continue;
      this[k] = this._s[k];
    }
  }

  get(key, def = null) {
    const v = this._s[key];
    return v !== undefined && v !== null ? v : def;
  }
}

function jsonStr(value) {
  const json = JSON.stringify(String(value ?? ''));
  if (!json || json.length < 2) return '';
  return json.slice(1, -1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function htmlJson(value) {
  const json = JSON.stringify(value, (_key, item) => {
    if (!(item instanceof Map)) return item;
    const keys = [...item.keys()];
    if (keys.every((key, index) => key === index)) return [...item.values()];
    return Object.fromEntries(item);
  });
  return (json === undefined ? 'null' : json).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** PHP-compatible range(). Twing's locutus range() treats step=-1 as
 *  `iVal -= walker` while walker is already negative, which grows forever. */
function phpRange(low, high, step) {
  const start = Number(low);
  const end = Number(high);
  let st = step == null || step === '' || step === false ? NaN : Number(step);
  if (!st) st = start <= end ? 1 : -1;
  const out = [];
  const cap = 10000;
  if (st > 0) {
    for (let i = start; i <= end && out.length < cap; i += st) out.push(i);
  } else {
    for (let i = start; i >= end && out.length < cap; i += st) out.push(i);
  }
  return out;
}

function nodeFilesystem() {
  return {
    statSync(p) {
      try {
        const s = fs.statSync(p);
        return { isFile: () => s.isFile(), mtime: s.mtime };
      } catch {
        return null;
      }
    },
    readFileSync(p) {
      try {
        return fs.readFileSync(p);
      } catch {
        return null;
      }
    },
  };
}

function buildEnv(templatesDir) {
  const loader = twing.createSynchronousFilesystemLoader(nodeFilesystem());
  loader.addPath(templatesDir);
  const env = twing.createSynchronousEnvironment(loader, {
    autoEscapingStrategy: 'html',
    charset: 'UTF-8',
  });

  // Twing 7 applies the environment strategy to the template body, but inherited
  // blocks and macro bodies execute outside it. Restore the intended HTML
  // escaping boundary for both; explicit |raw / context escapes remain.
  env.addNodeVisitor({
    enterNode: node => node,
    leaveNode: node => {
      // Macros execute outside the template body too; apply the same HTML
      // escaping boundary as inherited blocks. Explicit |raw remains opt-in.
      if (node.type === 'block' || node.type === 'macro') node.children.body = twing.createAutoEscapeNode('html', node.children.body, node.line, node.column);
      return node;
    },
  });

  const namedArgs = URL_FOR_NAMED.map((n) => ({ name: n, defaultValue: null }));
  env.addFunction(twing.createSynchronousFunction(
    'url_for',
    function urlForTwig(executionContext, endpoint, ...named) {
      const params = {};
      const mergeBag = (bag) => {
        if (!bag || typeof bag !== 'object') return;
        if (typeof bag.get === 'function' && typeof bag.keys === 'function' && !Array.isArray(bag)) {
          for (const k of bag.keys()) {
            const val = bag.get(k);
            if (val != null) params[String(k)] = val;
          }
          return;
        }
        for (const k of Object.keys(bag)) {
          if (bag[k] != null) params[k] = bag[k];
        }
      };
      for (let i = 0; i < named.length; i++) {
        const v = named[i];
        if (v == null) continue;
        if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
          mergeBag(v);
          continue;
        }
        if (i < URL_FOR_NAMED.length) params[URL_FOR_NAMED[i]] = v;
      }
      if (!currentApp) return '#';
      return currentApp.urlFor(String(endpoint || ''), params);
    },
    [{ name: 'endpoint' }, ...namedArgs]
  ));

  env.addFunction(twing.createSynchronousFunction(
    'constant',
    function constantTwig(executionContext, name) {
      if (Object.prototype.hasOwnProperty.call(PHP_CONSTANTS, name)) return PHP_CONSTANTS[name];
      return 0;
    },
    [{ name: 'name' }]
  ));

  env.addFunction(twing.createSynchronousFunction(
    'get_flashed_messages',
    function flashesTwig() {
      if (!currentApp) return [];
      if (currentApp.suppressFlashes) return [];
      return currentApp.getFlashedMessages();
    },
    []
  ));

  env.addFilter(twing.createSynchronousFilter('json_encode', (_context, value) => htmlJson(value), [{name: 'options', defaultValue: null}]));

  env.addFilter(twing.createSynchronousFilter(
    'json_str',
    function jsonStrTwig(executionContext, value) {
      return jsonStr(value);
    },
    []
  ));

  const coerceStr = (v) => (v == null ? '' : String(v));

  env.addFilter(twing.createSynchronousFilter(
    'lower',
    function lowerTwig(executionContext, value) {
      return coerceStr(value).toLowerCase();
    },
    []
  ));
  env.addFilter(twing.createSynchronousFilter(
    'upper',
    function upperTwig(executionContext, value) {
      return coerceStr(value).toUpperCase();
    },
    []
  ));
  env.addFilter(twing.createSynchronousFilter(
    'title',
    function titleTwig(executionContext, value) {
      const s = coerceStr(value).toLowerCase();
      return s.replace(/(^|\s+)(\S)/g, (m, sp, ch) => sp + ch.toUpperCase());
    },
    []
  ));
  env.addFilter(twing.createSynchronousFilter(
    'replace',
    function replaceTwig(executionContext, value, from) {
      let s = coerceStr(value);
      if (from == null) return s;
      const pairs = [];
      if (from instanceof Map) {
        for (const [k, v] of from) pairs.push([String(k), coerceStr(v)]);
      } else if (typeof from === 'object') {
        for (const k of Object.keys(from)) pairs.push([k, coerceStr(from[k])]);
      } else {
        return s;
      }
      pairs.sort((a, b) => b[0].length - a[0].length);
      for (const [k, v] of pairs) {
        if (k === '') continue;
        s = s.split(k).join(v);
      }
      return s;
    },
    [{ name: 'from' }]
  ));

  env.addFunction(twing.createSynchronousFunction(
    'range',
    function rangeTwig(executionContext, low, high, step) {
      return phpRange(low, high, step);
    },
    [
      { name: 'low' },
      { name: 'high' },
      { name: 'step', defaultValue: null },
    ]
  ));

  return env;
}

function getEnv(templatesDir) {
  const dir = path.resolve(templatesDir);
  if (!envSingleton || templatesDirCached !== dir) {
    envSingleton = buildEnv(dir);
    templatesDirCached = dir;
  }
  return envSingleton;
}

function render(template, context, app) {
  const dir = path.join(app.rootDir, 'templates');
  const env = getEnv(dir);
  const prev = currentApp;
  currentApp = app;
  try {
    return env.render(template, context);
  } finally {
    currentApp = prev;
  }
}

function loadAll(templatesDir) {
  const env = getEnv(templatesDir);
  const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith('.html'));
  const failed = [];
  for (const f of files) {
    try {
      env.loadTemplate(f);
    } catch (e) {
      failed.push({ file: f, error: e.message });
    }
  }
  return { total: files.length, failed };
}

module.exports = {
  render,
  loadAll,
  jsonStr,
  htmlJson,
  SessionBag,
  wrapSession: (session) => new SessionBag(session),
};
