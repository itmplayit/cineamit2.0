'use strict';

const Database = require('../db');

// Explicit booleans only: never treat the string "false" (or an array) as ON.
function parseFlag(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(text)) return true;
  if (['false', '0', 'off', 'no'].includes(text)) return false;
  return null;
}

function settingFlag(value, defaultValue) {
  // An absent row preserves the original defaults: registration ON, maintenance OFF.
  if (value === undefined) return defaultValue;
  const parsed = parseFlag(value);
  if (parsed === null) throw new Error('Invalid site-status setting value.');
  return parsed;
}

function submittedFlag(body, field) {
  body = body || {};
  const has = key => Object.prototype.hasOwnProperty.call(body, key);
  // Accept the old backend's explicit `enabled` field for existing admin clients.
  // Missing, duplicate/array, malformed or contradictory fields must not change state.
  const key = has(field) ? field : 'enabled';
  const parsed = has(key) ? parseFlag(body[key]) : null;
  if (parsed === null || (has(field) && has('enabled') && parseFlag(body.enabled) !== parsed)) {
    throw new Error('Choose an explicit ON or OFF value.');
  }
  return parsed;
}

async function readRegistrationEnabled() {
  const row = await Database.fetchOne("SELECT setting_value FROM site_setting WHERE setting_key = 'REGISTRATION_ENABLED'");
  return settingFlag(row ? row.setting_value : undefined, true);
}

async function readMaintenanceEnabled() {
  // Do not use a process-local/disk TTL for this access-control switch. Every new
  // request sees the committed DB value, including on another serverless worker.
  const row = await Database.fetchOne("SELECT setting_value FROM site_setting WHERE setting_key = 'MAINTENANCE_MODE'");
  return settingFlag(row ? row.setting_value : undefined, false);
}

module.exports = { parseFlag, settingFlag, submittedFlag, readRegistrationEnabled, readMaintenanceEnabled };
