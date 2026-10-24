#!/usr/bin/env node
'use strict';
// Explicit, trusted-local conversion only. Never run an untrusted downloaded JS config.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {serializeSettings}=require('../src/core/env-loader');
function convert(source, target) {
  source=path.resolve(source);target=path.resolve(target);
  if(source===target)throw new Error('Source and target must be different files.');
  if(fs.existsSync(target))throw new Error('Target already exists; refusing to overwrite it. Keep backups and compare privately.');
  let settings;
  try {settings=require(source);} catch {throw new Error('Cannot load the trusted legacy config. Check its path/syntax. No output was written.');}
  const text=serializeSettings(settings);
  const temp=target+'.migrate-'+crypto.randomBytes(8).toString('hex')+'.tmp';
  try {
    fs.writeFileSync(temp,text,{encoding:'utf8',flag:'wx',mode:0o600});
    // Atomic no-clobber publication. Existing target files/symlinks are never followed/overwritten.
    fs.linkSync(temp,target);
  } catch {throw new Error('Cannot safely create the target dotenv file. Check permissions and whether it already exists. Original config unchanged.');}
  finally {try{fs.unlinkSync(temp);}catch{}}
  return Object.keys(settings).length;
}
function main() {
  const root=path.resolve(__dirname,'..');let source=path.join(root,'env.js'),target=path.join(root,'.env');
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--from'&&args[i+1])source=path.resolve(args[++i]);
    else if(args[i]==='--to'&&args[i+1])target=path.resolve(args[++i]);
    else if(args[i]==='--help'){console.log('Usage: node tools/migrate-env.js [--from trusted-env.js] [--to .env]. Preserves original, refuses overwrite, prints no values.');return;}
    else throw new Error('Unknown/missing option. Use --help.');
  }
  const count=convert(source,target);
  console.log('Created private dotenv config; '+count+' settings verified losslessly. Original JS file unchanged. No secret values printed.');
  console.log('Check host environment overrides, keep SECRET_KEY unchanged, then restart. Keep the old config backup outside the public web root.');
}
if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
module.exports={convert};
