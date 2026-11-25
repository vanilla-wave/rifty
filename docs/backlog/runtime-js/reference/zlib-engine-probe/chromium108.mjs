// Chromium 108 (ADR-0469's supported floor): can zlib.wasm (64 KB) compile synchronously on the main
// thread, in a dedicated Worker, and asynchronously; does the engine round-trip there.
// Runner: the floor lane's pin (tools/floor-lane/run.mjs: playwright 1.28.1, `install chromium` under
// Node 18.20.8, PLAYWRIGHT_BROWSERS_PATH=<runner>/browsers).
// usage: PLAYWRIGHT_BROWSERS_PATH=RUNNER/browsers node chromium108.mjs BUILD RUNNER/node_modules/playwright DEPS
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [build, runner, deps] = process.argv.slice(2);
const { chromium } = createRequire(join(runner, 'package.json'))('./index.js');
const WASM = [...readFileSync(join(build, 'zlib.wasm'))];
const CORE = readFileSync(new URL('./bench-core.js', import.meta.url), 'utf8');
const PAKO = readFileSync(join(deps, 'pako3/package/dist/browser/pako.umd.min.js'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
console.log(`chromium ${browser.version()}`);
const out = await page.evaluate(
  async ({ bytes, core, pako }) => {
    const b = new Uint8Array(bytes);
    const r = {};
    const tryIt = (f) => {
      try {
        return f();
      } catch (e) {
        return `${e.name}: ${e.message}`;
      }
    };
    r.mainSyncCompile = tryIt(() => {
      new WebAssembly.Module(b);
      return 'ok';
    });
    r.mainAsyncCompileThenSyncInstance = await WebAssembly.compile(b).then(
      (m) =>
        tryIt(() => {
          new WebAssembly.Instance(m, {});
          return 'ok';
        }),
      (e) => `${e.name}: ${e.message}`,
    );
    const src = `${pako}\n${core}\nonmessage = (e) => { const r = {}; try { new WebAssembly.Module(e.data); r.workerSyncCompile = 'ok'; globalThis.ZLIB_WASM = e.data; const f = zbench.firstUse('wasm'); r.workerFirstUseMs = f.ms; const { compressed, ...run } = zbench.run('wasm', 1, 3); r.worker1MiB = run; r.pako1MiB = (({ compressed, ...x }) => x)(zbench.run('pako', 1, 3)); } catch (err) { r.error = err.name + ': ' + err.message; } postMessage(r); };`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    r.worker = await new Promise((res) => {
      w.onmessage = (e) => res(e.data);
      w.onerror = (e) => res({ error: e.message });
      w.postMessage(b);
    });
    return r;
  },
  { bytes: WASM, core: CORE, pako: PAKO },
);
console.log(JSON.stringify(out, null, 1));
await browser.close();
