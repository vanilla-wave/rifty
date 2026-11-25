// Usage: node chromium-step.cjs <repo> <node-rec.json> <out.json> : Chromium URL host parse for each unique toASCII input.
'use strict';
const fs = require('node:fs');
const [repo, recPath, out] = process.argv.slice(2);
const { chromium } = require(require.resolve('@playwright/test', { paths: [repo] }));
(async () => {
  const rows = JSON.parse(fs.readFileSync(recPath, 'utf8'));
  const inputs = [...new Set(rows.flatMap((r) => r.calls.map((c) => c[0])))];
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage();
  const ver = browser.version();
  const res = await page.evaluate((inputs) => {
    const t0 = performance.now();
    const o = inputs.map((h) => {
      try {
        return new URL(`http://${h}/`).hostname;
      } catch {
        return null;
      }
    });
    // warm timing of a non-ASCII host
    let x;
    const t1 = performance.now();
    for (let i = 0; i < 10000; i++) x = new URL('http://ñ.com/').hostname;
    const t2 = performance.now();
    return { o, ua: navigator.userAgent, perCallUs: ((t2 - t1) / 10000) * 1000, total: t1 - t0, x };
  }, inputs);
  await browser.close();
  const map = Object.fromEntries(inputs.map((h, i) => [h, res.o[i]]));
  fs.writeFileSync(
    out,
    JSON.stringify({ version: ver, ua: res.ua, perCallUs: res.perCallUs, map }),
  );
  console.log(ver, res.ua, 'inputs', inputs.length, 'perCall µs', res.perCallUs.toFixed(2));
})();
