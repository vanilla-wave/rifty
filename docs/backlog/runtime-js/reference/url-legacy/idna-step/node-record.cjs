// Run with: node --expose-internals node-record.cjs <node-src> <corpus.json> <out.json>
// Loads a copy of Node's lib/url.js whose toASCII records its input/output; checks the copy equals real url.parse.
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { internalBinding, primordials } = require('internal/test/binding');
process.removeAllListeners('warning');
process.on('warning', () => {});
const [src, corpusPath, out] = process.argv.slice(2);
const realEnc = internalBinding('encoding_binding');
let calls = [];
const enc = {
  ...realEnc,
  toASCII(h) {
    const o = realEnc.toASCII(h);
    calls.push([h, o]);
    return o;
  },
};
const ib = (n) => (n === 'encoding_binding' ? enc : internalBinding(n));
const fn = vm.compileFunction(fs.readFileSync(path.join(src, 'lib/url.js'), 'utf8'), [
  'exports',
  'require',
  'module',
  'process',
  'internalBinding',
  'primordials',
]);
const mod = { exports: {} };
fn(mod.exports, require, mod, process, ib, primordials);
const copy = mod.exports;
const real = require('node:url');
const res = (f) => {
  try {
    return { h: f().hostname };
  } catch (e) {
    return { err: e.code || e.name };
  }
};
const rows = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
let mismatch = 0;
for (const r of rows) {
  const u = `http://${r.src}/`;
  r.node = res(() => real.parse(u));
  calls = [];
  const c = res(() => copy.parse(u));
  if (JSON.stringify(c) !== JSON.stringify(r.node)) mismatch++;
  r.calls = calls;
}
fs.writeFileSync(out, JSON.stringify(rows));
console.log(
  'rows',
  rows.length,
  'copy!=real',
  mismatch,
  'withToASCII',
  rows.filter((r) => r.calls.length).length,
);
