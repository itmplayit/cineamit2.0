#!/usr/bin/env node
'use strict';
// Manual only. No startup hooks, schedulers, Google Indexing API, or automatic submissions.
const fs=require('node:fs'),path=require('node:path');
const Seo=require('../src/seo');
const PAGINATED_EXACT=new Set(['/movies','/series','/anime','/actors']);
const PAGINATED_DETAIL=/^\/(?:studio\/\d+|provider\/\d+\/(?:movie|tv)|movies\/(?:bollywood|hollywood|south|popular|indian|top-10-india)|shows\/(?:netflix|prime|apple|top|anime|korean))$/;
function allowsPage(pathname){return PAGINATED_EXACT.has(pathname)||PAGINATED_DETAIL.test(pathname);}
function buildPlan(rawUrls, settings) {
  const root=Seo.origin(settings.SEO_PUBLIC_ORIGIN || settings.APP_PUBLIC_ORIGIN);
  if (!root) throw new Error('Configure SEO_PUBLIC_ORIGIN as the canonical HTTPS origin first.');
  const base=new URL(root);
  if (require('node:net').isIP(base.hostname.replace(/^\[|\]$/g,'')) || !base.hostname.includes('.') || /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(base.hostname) || /\.(?:local|internal)$/i.test(base.hostname)) throw new Error('IndexNow needs a public hostname.');
  const key=String(settings.INDEXNOW_KEY || '');
  if (key && !/^[A-Za-z0-9-]{8,128}$/.test(key)) throw new Error('Invalid INDEXNOW_KEY.');
  const candidates=rawUrls.map(raw=>{
    const u=new URL(raw);
    if (u.origin!==root || u.username || u.password || u.hash || !Seo.publicPath(u.pathname) || u.pathname!==Seo.normalizedPath(u.pathname)) throw new Error('Only same-origin canonical public URLs are allowed: '+raw);
    if (u.search && !allowsPage(u.pathname)) throw new Error('This route does not emit a paginated canonical URL: '+raw);
    for (const [k,v] of u.searchParams) if(k!=='page' || !/^\d+$/.test(v) || String(Number(v))!==v || Number(v)<2 || Number(v)>500) throw new Error('Only a canonical page=2..500 parameter is allowed: '+raw);
    if (u.searchParams.getAll('page').length>1) throw new Error('Duplicate page parameter.');
    const query=u.searchParams.toString();
    return u.origin+u.pathname+(query?'?'+query:'');
  });
  // URL parsing normalizes host case/default ports before duplicate removal.
  const urls=[...new Set(candidates)];
  if (!urls.length || urls.length>10000) throw new Error('Supply between 1 and 10000 actually changed public URLs.');
  return {host:base.host,key,keyLocation:root+'/indexnow-key.txt',urlList:urls};
}
async function main() {
  const args=process.argv.slice(2);let send=false;const urls=[];
  for(let i=0;i<args.length;i++) {
    const a=args[i];if(a==='--send') send=true;
    else if(a==='--file') {if(!args[i+1])throw new Error('--file needs a UTF-8 path.');urls.push(...fs.readFileSync(args[++i],'utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')));}
    else if(a.startsWith('--'))throw new Error('Unknown option: '+a);
    else urls.push(a);
  }
  if (!urls.length) throw new Error('Usage: node tools/indexnow.js [--file changed-urls.txt | URL ...] [--send]. Default: DRY RUN, no requests.');
  const settings=require('../src/core/env-loader').loadSettings({rootDir:path.resolve(__dirname,'..')}),plan=buildPlan(urls,settings);
  if (!send) {console.log(JSON.stringify({mode:'DRY_RUN',requestsSent:0,...plan,key:plan.key?'configured (redacted)':'NOT CONFIGURED'},null,2));return;}
  if (!plan.key) throw new Error('INDEXNOW_KEY is disabled. Configure and deploy the proof route before --send.');
  const proof=await fetch(plan.keyLocation,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(proof.status!==200 || (await proof.text()).trim()!==plan.key) throw new Error('Live key proof does not match. No IndexNow submission sent.');
  const res=await fetch('https://api.indexnow.org/indexnow',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(plan),redirect:'error',signal:AbortSignal.timeout(20000)});
  console.log('IndexNow HTTP '+res.status+': '+(res.status===200?'received; indexing/ranking is NOT guaranteed':res.status===202?'received; key validation pending, NOT indexed':'submission not confirmed; inspect configuration/rate limits'));
  if (![200,202].includes(res.status)) process.exitCode=1;
}
if (require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={buildPlan};
