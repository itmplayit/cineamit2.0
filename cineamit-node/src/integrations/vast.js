'use strict';
const Config = require('../core/config');
const {XMLValidator} = require('fast-xml-parser');

function allowed(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) return false;
  const hosts = String(Config.VAST_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  for (const configured of [Config.HILLTOPADS_VAST_URL, Config.VAST_FALLBACK_URL]) {
    try { hosts.push(new URL(configured).hostname.toLowerCase()); } catch {}
  }
  return hosts.includes(parsed.hostname.toLowerCase());
}
function validXml(body) {
  const xml = String(body || '');
  if (Buffer.byteLength(xml) > 1048576 || /<!DOCTYPE|<!ENTITY|<\/?(?:html|script|svg)\b/i.test(xml)) return false;
  if (!/^\s*(?:<\?xml[^?]*\?>\s*)?<VAST(?:\s|>)/i.test(xml)) return false;
  return XMLValidator.validate(xml) === true;
}
module.exports = {allowed, validXml};
