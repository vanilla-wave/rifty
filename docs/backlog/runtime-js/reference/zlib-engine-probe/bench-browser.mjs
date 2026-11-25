// Chromium (rifty's @playwright/test 1.60.0): sync wasm compile on the main thread and in a dedicated
// worker, first use, speed at 1 and 50 MiB inside a worker. No server: about:blank + Blob worker.
// usage: node bench-browser.mjs DEPS BUILD REPO_ROOT
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [deps, build, repo] = process.argv.slice(2);
const { chromium } = createRequire(join(repo, 'package.json'))('@playwright/test');
const PAKO = readFileSync(join(deps, 'pako3/package/dist/browser/pako.umd.min.js'), 'utf8');
const WASM = [...readFileSync(join(build, 'zlib.wasm'))];
const CORE = readFileSync(new URL('./bench-core.js', import.meta.url), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
console.log(`chromium ${browser.version()}`);
const mainThread = await page.evaluate((bytes) => {
  const b = new Uint8Array(bytes);
  try {
    new WebAssembly.Module(b);
    return { mainThreadSyncCompile: 'ok' };
  } catch (e) {
    return { mainThreadSyncCompile: `${e.name}: ${e.message}` };
  }
}, WASM);
console.log(JSON.stringify(mainThread));
// Today's browser-host backend (ADR-0159): Chromium's DecompressionStream on 2 gzip members / a tail.
const zlib = await import('node:zlib');
const web = await page.evaluate(
  async ({ g2, ztail }) => {
    const run = async (fmt, bytes) => {
      const ds = new DecompressionStream(fmt);
      const w = ds.writable.getWriter();
      w.write(new Uint8Array(bytes)).catch(() => {});
      w.close().catch(() => {});
      const r = ds.readable.getReader();
      let out = '';
      try {
        for (;;) {
          const { done, value } = await r.read();
          if (done) break;
          out += new TextDecoder().decode(value);
        }
        return `ok ${out}`;
      } catch (e) {
        return `${e.name}: ${e.message} (read before: ${JSON.stringify(out)})`;
      }
    };
    return {
      gzip2Members: await run('gzip', g2),
      deflatePlusLF: (await run('deflate', ztail)).slice(0, 80),
    };
  },
  {
    g2: [...Buffer.concat([zlib.gzipSync('first '), zlib.gzipSync('second')])],
    ztail: [...Buffer.concat([zlib.deflateSync('abc'), Buffer.from('\n')])],
  },
);
console.log(
  JSON.stringify({
    chromiumDecompressionStream: web,
    node: 'gunzip → "first second"; inflate + LF → "abc"',
  }),
);
const results = await page.evaluate(
  async ({ pako, core, bytes }) => {
    const src = `${pako}\n${core}\nonmessage = (e) => { const [op, ...a] = e.data; try { globalThis.ZLIB_WASM ??= new Uint8Array(a.pop()); const r = op === 'first' ? zbench.firstUse(a[0]) : (({ compressed, ...r }) => r)(zbench.run(a[0], a[1], a[1] === 1 ? 5 : 1)); postMessage(r); } catch (err) { postMessage({ error: String(err) }); } };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const call = (...args) =>
      new Promise((res) => {
        const w = new Worker(url);
        w.onmessage = (e) => {
          res(e.data);
          w.terminate();
        };
        w.postMessage([...args, bytes]);
      });
    const out = [];
    for (const name of ['pako', 'wasm']) {
      const f = [];
      for (let i = 0; i < 7; i++) f.push(await call('first', name));
      f.sort((a, b) => a.ms - b.ms);
      out.push({
        realm: 'worker',
        engine: name,
        firstUseMedianMs: +f[3].ms.toFixed(2),
        init: f[3].init,
      });
    }
    for (const mib of [1, 50])
      for (const name of ['pako', 'wasm'])
        out.push({ realm: 'worker', ...(await call('run', name, mib)) });
    return out;
  },
  { pako: PAKO, core: CORE, bytes: WASM },
);
for (const r of results) console.log(JSON.stringify(r));
await browser.close();
