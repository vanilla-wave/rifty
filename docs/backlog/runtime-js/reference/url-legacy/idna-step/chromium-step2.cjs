// (c'): ASCII-plain → as is; xn-- labels punycode-decoded, whole domain through Chromium URL,
// each xn-- label must round-trip unchanged. node chromium-step2.cjs <repo> <pkgs> <node-rec.json> <out.json>
'use strict';
const fs = require('node:fs');
const [repo, pkgs, recPath, out] = process.argv.slice(2);
const { chromium } = require(require.resolve('@playwright/test', { paths: [repo] }));
const punyPath = require.resolve('punycode/punycode.js', { paths: [pkgs] });
(async () => {
  const rows = JSON.parse(fs.readFileSync(recPath, 'utf8'));
  const inputs = [...new Set(rows.flatMap((r) => r.calls.map((c) => c[0])))];
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage();
  await page.addScriptTag({
    content: `var module={exports:{}};${fs.readFileSync(punyPath, 'utf8')};window.punycode=module.exports;`,
  });
  const o = await page.evaluate(
    (inputs) =>
      inputs.map((h) => {
        if (/^[^\u0080-\uffff]*$/.test(h) && !/(^|\.)xn--/.test(h)) return h;
        const labels = h.split('.');
        const xn = [];
        for (let i = 0; i < labels.length; i++) {
          if (!labels[i].startsWith('xn--')) continue;
          let d;
          try {
            d = punycode.decode(labels[i].slice(4));
          } catch {
            return null;
          }
          if (/^[^\u0080-\uffff]*$/.test(d)) return null;
          xn.push(i);
          labels[i] = d;
        }
        let r;
        try {
          r = new URL(`http://${labels.join('.')}/`).hostname;
        } catch {
          return null;
        }
        const rl = r.split('.');
        const hl = h.split('.');
        for (const i of xn) if (rl[i] !== hl[i] || rl.length !== hl.length) return null;
        return r;
      }),
    inputs,
  );
  await browser.close();
  fs.writeFileSync(
    out,
    JSON.stringify({
      version: browser.version(),
      map: Object.fromEntries(inputs.map((h, i) => [h, o[i]])),
    }),
  );
})();
