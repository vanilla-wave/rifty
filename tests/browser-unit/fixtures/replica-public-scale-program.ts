/** Executed unchanged by native Node and the public Workbench terminal. */
export const program =
  "const fs=require('node:fs');console.log(JSON.stringify({ms:require('ms')('2s'),note:fs.readFileSync('note.txt','utf8'),...(process.argv.includes('--installed')?{chunk:require('lodash').chunk([1,2,3],2)}:{})}));";
export const verifyTree =
  "const fs=require('node:fs');const m=JSON.parse(fs.readFileSync('node_modules/.tracker-scale-manifest.json','utf8'));let bytes=0;for(const [p,n] of m.files){const s=fs.statSync('node_modules/.tracker-scale/'+p);if(!s.isFile()||s.size!==n)throw Error(p);bytes+=s.size;}console.log(JSON.stringify({files:m.files.length,bytes}));";

export const verifyInstalled =
  "const fs=require('node:fs'),crypto=require('node:crypto');const m=JSON.parse(fs.readFileSync('installed-manifest.json','utf8'));for(const [p,n,h] of m){const b=fs.readFileSync('node_modules/'+p);if(b.length!==n||crypto.createHash('sha256').update(b).digest('hex')!==h)throw Error('Installed file differs: '+p);}console.log(JSON.stringify({files:m.length}));";
