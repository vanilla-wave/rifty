/** Executed unchanged by native Node and the public Workbench terminal. */
export const program =
  "const fs=require('node:fs');console.log(JSON.stringify({ms:require('ms')('2s'),note:fs.readFileSync('note.txt','utf8'),...(process.argv.includes('--installed')?{chunk:require('lodash').chunk([1,2,3],2)}:{})}));";
export const verifyTree =
  "const fs=require('node:fs');const m=JSON.parse(fs.readFileSync('node_modules/.tracker-scale-manifest.json','utf8'));let bytes=0;for(const [p,n] of m.files){const s=fs.statSync('node_modules/.tracker-scale/'+p);if(!s.isFile()||s.size!==n)throw Error(p);bytes+=s.size;}console.log(JSON.stringify({files:m.files.length,bytes}));";
