// Usage: node --expose-internals residual.cjs <repo> <Node lib/url.js> <out.json>
// The browser-host residual of ADR-0574's `toASCII` over `hosts.json`: Node's lib/url.js copy with
// its `toASCII` replaced by rifty's step (`to-ascii.ts`) as Chromium computes it, record by record
// against live Node. Output: the pinned rows of tests/browser-unit/url-legacy.spec.ts.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { internalBinding, primordials } = require('internal/test/binding');
const [repo, urlJs, out] = process.argv.slice(2);
const fixtures = path.join(repo, 'packages/runtime-js/tests/fixtures/url-legacy');
const { record } = require(path.join(fixtures, 'codec.cjs'));
const req = (m) => require(require.resolve(m, { paths: [repo] }));
process.removeAllListeners('warning');
process.on('warning', () => {});
function urlWith(toASCII) {
  const mod = { exports: {} };
  const enc = { ...internalBinding('encoding_binding'), toASCII };
  vm.compileFunction(fs.readFileSync(urlJs, 'utf8'), [
    'exports',
    'require',
    'module',
    'process',
    'internalBinding',
    'primordials',
  ])(
    mod.exports,
    require,
    mod,
    process,
    (n) => (n === 'encoding_binding' ? enc : internalBinding(n)),
    primordials,
  );
  return mod.exports;
}
(async () => {
  const { hosts } = JSON.parse(fs.readFileSync(path.join(fixtures, 'hosts.json'), 'utf8'));
  const inputs = new Set();
  const spy = urlWith((h) => {
    inputs.add(h);
    return internalBinding('encoding_binding').toASCII(h);
  });
  for (const h of hosts) record(() => spy.parse(`http://${h}/`));
  const bundle = await req('esbuild').build({
    entryPoints: [path.join(repo, 'packages/runtime-js/src/builtins/url-legacy/to-ascii.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'TA',
    write: false,
    absWorkingDir: repo,
  });
  const browser = await req('@playwright/test').chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const list = [...inputs];
  const step = await page.evaluate((list) => {
    const t = TA.createToASCII(
      TA.nativeHostOf(URL, Object.getOwnPropertyDescriptor(URL.prototype, 'hostname').get),
    );
    return list.map((h) => t(h));
  }, list);
  const version = browser.version();
  await browser.close();
  const table = new Map(list.map((h, i) => [h, step[i]]));
  const port = urlWith((h) => table.get(h));
  const real = require('node:url');
  const rows = [];
  hosts.forEach((h, i) => {
    const node = record(() => real.parse(`http://${h}/`).hostname);
    const rifty = record(() => port.parse(`http://${h}/`).hostname);
    if (JSON.stringify(node) !== JSON.stringify(rifty)) rows.push({ i, host: h, node, rifty });
  });
  fs.writeFileSync(
    out,
    `${JSON.stringify({ chromium: version, node: process.version, rows }, null, 1)}\n`,
  );
  console.log(`chromium ${version}: ${rows.length} residual rows of ${hosts.length}`);
})();
