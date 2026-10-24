'use strict';
// Native Node dotenv parser: data only, no JavaScript execution/interpolation.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

function loadSettings({rootDir = path.resolve(__dirname, '../..'), env = process.env} = {}) {
  const custom = String(env.CINE_CONFIG_FILE || '').trim();
  const file = custom ? path.resolve(rootDir, custom) : path.join(rootDir, '.env');
  if (/\.(?:c|m)?js$/i.test(file)) {
    throw new Error('CINE_CONFIG_FILE must point to dotenv text, not JavaScript. Convert trusted env.js with: node tools/migrate-env.js');
  }
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw new Error('Cannot read the configuration file. Check its path and permissions.');
    if (custom) throw new Error('CINE_CONFIG_FILE does not exist. Use an existing dotenv file.');
    if (fs.existsSync(path.join(rootDir, 'env.js'))) {
      throw new Error('Legacy env.js found; it is not executed automatically. Back it up, then run: node tools/migrate-env.js');
    }
    // Environment-only hosting is supported; Config.load validates required keys.
    text = '';
  }
  if (text.includes('\0')) throw new Error('Dotenv configuration must not contain NUL bytes.');
  const parsed = parseEnv(text.replace(/^\uFEFF/, ''));
  // Host/dashboard environment overrides file values, including intentional empty strings.
  // Do not populate process.env or print file contents/secrets.
  const settings = {...parsed};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) settings[key] = value;
  return settings;
}

function serializeSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Legacy configuration must export a settings object.');
  const prototype = Object.getPrototypeOf(settings);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Legacy configuration must be a plain own-property object; inherited settings are not supported. No output was written.');
  const ownNames = Object.getOwnPropertyNames(settings);
  if (!ownNames.length || Object.getOwnPropertySymbols(settings).length) throw new Error('Legacy configuration must contain only enumerable string settings. No output was written.');
  for (const key of ownNames) if (!Object.prototype.propertyIsEnumerable.call(settings, key)) throw new Error('Legacy configuration contains non-enumerable settings that cannot be converted losslessly. No output was written.');
  const lines = ['# Converted from a trusted local JavaScript config. Private: do not commit.', '# Preserve SECRET_KEY; host environment variables override this file.'];
  for (const [key, value] of Object.entries(settings)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Legacy configuration has an unsupported key name. No output was written.');
    if (!['string', 'number', 'boolean', 'undefined'].includes(typeof value) && value !== null) throw new Error('Unsupported legacy value for '+key+'. No output was written.');
    const str = value == null ? '' : String(value);
    if (str.includes('\0')) throw new Error('NUL is unsupported for '+key+'. No output was written.');
    const candidates = ['"'+str+'"', "'"+str+"'", '`'+str+'`', str];
    const encoded = candidates.find(candidate => {
      const parsed = parseEnv(key+'='+candidate+'\n');
      return Object.keys(parsed).length === 1 && parsed[key] === str;
    });
    if (encoded === undefined) throw new Error('Cannot represent '+key+' losslessly in native dotenv syntax. Keep the original file; no output was written.');
    lines.push(key+'='+encoded);
  }
  const output = lines.join('\n')+'\n';
  const check = parseEnv(output);
  for (const [key, value] of Object.entries(settings)) if (check[key] !== (value == null ? '' : String(value))) throw new Error('Lossless dotenv verification failed. No output was written.');
  return output;
}
module.exports = {loadSettings, serializeSettings};
