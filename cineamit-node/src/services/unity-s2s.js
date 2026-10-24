'use strict';
const crypto = require('crypto');

class UnityVerificationError extends Error {
  constructor(code, status = 403) { super(code); this.code = code; this.status = status; }
}
function rewardUnit(gameId, placement) { return `unity:${gameId}:${placement}`; }
// Unity's documented S2S protocol; never trust the client's SDK completion callback.
function verifyUnityCallback(url, {enabled, secret, gameId, placement}) {
  const reject = (code, status) => { throw new UnityVerificationError(code, status); };
  if (!enabled || typeof secret !== 'string' || secret.length < 32) reject('rewards_disabled', 503);
  const raw = String(url || '').split('?').slice(1).join('?');
  if (!raw || raw.length > 4096 || raw.includes('#')) reject('invalid_query', 400);
  const fields = new Map();
  for (const pair of raw.split('&')) {
    const eq = pair.indexOf('='); if (eq < 1) reject('invalid_query', 400);
    let key, value;
    try { key = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' ')); value = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' ')); }
    catch { reject('invalid_query', 400); }
    if (!['sid','oid','hmac','game_id','placement_id'].includes(key) || fields.has(key)) reject('invalid_query', 400);
    fields.set(key, value);
  }
  if (fields.size !== 5) reject('invalid_query', 400);
  const sent = fields.get('hmac');
  if (!/^[a-fA-F0-9]{32}$/.test(sent)) reject('invalid_signature');
  const canonical = [...fields.keys()].filter(k => k !== 'hmac').sort().map(k => `${k}=${fields.get(k)}`).join(',');
  const expected = crypto.createHmac('md5', secret).update(canonical, 'utf8').digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(sent, 'hex'))) reject('invalid_signature');
  if (fields.get('game_id') !== gameId || fields.get('placement_id') !== placement) reject('invalid_binding');
  const sid = /^([1-9][0-9]{0,14})\.([a-f0-9]{32})$/.exec(fields.get('sid'));
  const oid = fields.get('oid');
  if (!sid || !Number.isSafeInteger(Number(sid[1])) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(oid)) reject('invalid_reward');
  // Preserve existing short IDs; long accepted OIDs must still fit VARCHAR(128).
  // A distinct prefix makes hashed IDs disjoint from all legacy/raw event IDs.
  const eventId = oid.length <= 122 ? `unity:${oid}` : `unity-hash:${crypto.createHash('sha256').update(oid, 'utf8').digest('hex')}`;
  return {userId: Number(sid[1]), ticket: sid[2], eventId, adUnit: rewardUnit(gameId, placement)};
}
module.exports = {verifyUnityCallback, UnityVerificationError, rewardUnit};
