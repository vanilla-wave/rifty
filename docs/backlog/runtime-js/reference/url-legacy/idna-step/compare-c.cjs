// Usage: node compare-c.cjs <node-rec.json> <chromium.json> <pkgs dir>
'use strict';
const fs = require('node:fs');
const [recP, chP, pkgs] = process.argv.slice(2);
const tr46 = require(require.resolve('tr46', { paths: [pkgs] }));
const rows = JSON.parse(fs.readFileSync(recP, 'utf8'));
const ch = JSON.parse(fs.readFileSync(chP, 'utf8'));
const forbidden = /[\0\t\n\r #%/:<>?@[\\\]^|]/;
const fin = (o) => (o == null || o === '' || forbidden.test(o) ? 'THROW' : o);
const isAsciiPlain = (h) => /^[^\u0080-\uffff]*$/.test(h) && !/(^|\.)xn--/.test(h);
const F = {
  checkBidi: false,
  checkHyphens: false,
  checkJoiners: true,
  useSTD3ASCIIRules: false,
  transitionalProcessing: false,
  verifyDNSLength: false,
};
const t = (h, o) => {
  const r = tr46.toASCII(h, { ...F, ...o });
  return r === null ? 'THROW' : fin(r);
};
const stats = {
  idna: { rows: 0, step: 0, diff: 0, cls: {} },
  probe: { rows: 0, step: 0, diff: 0, cls: {} },
};
const ex = {};
let plainAsciiNodeDiff = 0;
let tr46Diff = 0;
for (const r of rows) {
  const s = stats[r.set];
  s.rows++;
  for (const [h, nodeOut] of r.calls) {
    const n = fin(nodeOut);
    if (isAsciiPlain(h)) {
      if (n !== fin(h)) plainAsciiNodeDiff++;
      continue;
    }
    if (t(h, {}) !== n) tr46Diff++;
    s.step++;
    const c = fin(ch.map[h]);
    if (c === n) continue;
    s.diff++;
    let cls;
    if (t(h, {}) === n && t(h, { checkBidi: true }) === c) cls = 'bidi';
    else if (/%/.test(h) || /%/.test(String(nodeOut))) cls = 'percent';
    else if (c !== 'THROW' && /^\d+\.\d+\.\d+\.\d+$/.test(c)) cls = 'ipv4';
    else cls = 'other';
    s.cls[cls] = (s.cls[cls] || 0) + 1;
    ex[cls] ??= [];
    if (ex[cls].length < 8)
      ex[cls].push({ set: r.set, h: JSON.stringify(h), node: n, chromium: c });
  }
}
console.log(
  JSON.stringify(
    { chromium: ch.version, stats, plainAsciiNodeDiff, tr46VsNodeDiffOnStep: tr46Diff },
    null,
    1,
  ),
);
for (const k in ex) {
  console.log('--', k);
  for (const e of ex[k]) console.log(e);
}
