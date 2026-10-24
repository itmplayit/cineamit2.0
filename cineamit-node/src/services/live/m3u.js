'use strict';

const { ssrfBlockedHostAsync, ssrfResolveRedirectUrl, ssrfSafeHttpGet } = require('../../security/ssrf');

// M3U/M3U8 playlist parsing.
function parseM3uLines(lines, baseUrl = '') {
  const channels = [];
  const categories = { All: true };
  let current = {};
  for (let line of lines) {
    line = String(line).trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      let category = 'Other';
      const gm = line.match(/group-title="([^"]+)"/);
      if (gm) category = gm[1];
      categories[category] = true;
      current.category = category;
      current.logo = '';
      const lm = line.match(/tvg-logo="([^"]+)"/);
      if (lm) {
        const logoVal = lm[1];
        if (logoVal.startsWith('http://') || logoVal.startsWith('https://') || logoVal.startsWith('/')) {
          current.logo = (logoVal.startsWith('/') && baseUrl) ? (ssrfResolveRedirectUrl(baseUrl, logoVal) || '') : logoVal;
        }
      }
      const parts = line.split(',');
      current.name = (parts[parts.length - 1] || '').trim() || 'Unknown';
      current.tvg_id = '';
      const tm = line.match(/tvg-id="([^"]+)"/);
      if (tm) current.tvg_id = tm[1];
    } else if (!line.startsWith('#')) {
      let streamUrl = Security.decodeHtmlEntities(line.trim()).replace(/&amp;/g, '&');
      streamUrl = streamUrl.replace(/^(?:ffmpeg|auto)\s+/i, '').trim();
      if (!/^https?:\/\//i.test(streamUrl)) {
        if (!baseUrl || /^[a-z][a-z0-9+.-]*:/i.test(streamUrl)) streamUrl = '';
        else streamUrl = ssrfResolveRedirectUrl(baseUrl, streamUrl) || '';
      }
      current.url = streamUrl;
      if (current.name && !/^#{3,}.*#{3,}$/.test(current.name)) channels.push(current);
      current = {};
    }
  }
  const cats = Object.keys(categories).sort();
  return [channels, cats];
}

async function parseM3uPlaylist(source, isUrl = true) {
  try {
    if (isUrl) {
      source = Security.decodeHtmlEntities(String(source).trim());
      if (!/^https?:\/\//i.test(source)) throw new Error('Invalid M3U URL scheme');
      let host = '';
      try { host = new URL(source).hostname; } catch { throw new Error('Invalid M3U URL'); }
      if (!host || await ssrfBlockedHostAsync(host)) throw new Error('Blocked M3U host (SSRF protection)');
      const fetch = await ssrfSafeHttpGet(source, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' },
      }, 3, false, false, 20 * 1024 * 1024);
      if (!fetch.ok) throw new Error('M3U fetch failed: ' + (fetch.error || 'unknown error'));
      const content = Security.decodeHtmlEntities(Security.decodeHtmlEntities(String(fetch.body)));
      if (content.length < 10) throw new Error('Empty response');
      return parseM3uLines(content.split(/\r\n|\n|\r/), source);
    }
    throw new Error('Local M3U file not allowed or not found');
  } catch (e) {
    console.error('[livetv] M3U playlist load failed (details suppressed).');
    return [[{ name: '⚠ M3U source unavailable or unsupported', logo: '', url: '', category: 'All', tvg_id: '' }], ['All']];
  }
}

module.exports = { parseM3uLines, parseM3uPlaylist };
