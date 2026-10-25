# CSP prerequisite discriminator

Command: `node /tmp/rifty-pr340-csp-probe.mjs` (save the block below there; run
from repository root). Node v24.16.0, Playwright 1.60.0, Chromium 148.0.7778.96.
Fresh contexts; native module parent/child Workers, dynamic import,
`new Function` and `WebAssembly.compile`; no runtime stubs.

Every parent Worker loaded and imported `/module.js` → 17. Worker-response CSP:

| Mode / CSP | JS evaluation | WASM compile | nested Worker |
|---|---|---|---|
| plain: script-src self | EvalError | CompileError | ready |
| wasm: + wasm-unsafe-eval | EvalError | compiled | ready |
| eval: + unsafe-eval | 42 | compiled | ready |
| nested: eval + worker-src none | 42 | compiled | error |

Inference: one successful Worker or WASM compile does not prove the runtime's
nested Worker/JS-evaluation requirements. The minimal empty WASM compilation
proves that operation only, not QuickJS/WASI or their artifacts.

Source: `worker-entry.ts:167` skips QuickJS preload under rewrite (ADR-0383).
This does not prove absence of every possible WASM dependency. Rewrite uses
`new Function` in `builtins/vm/rewrite-engine.ts:231`; generic CJS/ESM execution
also dynamically compiles JS. Required/optional checks must follow those paths.

[MDN script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)
corroborates separate JS/WASM permissions.
[SW register](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)
creates/updates a scope registration; a safe capability probe does not establish
the actual deployment's controlling SW. Neither SW registration nor actual
rifty boot was exercised by this discriminator.

## Executed source

```js
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const require = createRequire(resolve('package.json'));
const { chromium } = require('@playwright/test');
const worker = `
const result = {};
try { result.js = new Function('return 42')(); } catch(e) { result.js = e.name; }
try { await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])); result.wasm = 'compiled'; } catch(e) { result.wasm = e.name; }
result.imported = (await import('/module.js')).value;
result.nested = await new Promise(resolve => {
  const child = new Worker('/child.js', {type:'module'});
  const timer = setTimeout(() => { child.terminate(); resolve('timeout'); }, 2000);
  const finish = value => { clearTimeout(timer); child.terminate(); resolve(value); };
  child.onmessage = e => finish(e.data);
  child.onerror = e => { e.preventDefault(); finish('error'); };
});
postMessage(result);`;
const server = createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  if(url.pathname === '/parent.js') {
    const policies = { plain: "script-src 'self'", wasm: "script-src 'self' 'wasm-unsafe-eval'", eval: "script-src 'self' 'unsafe-eval'", nested: "script-src 'self' 'unsafe-eval'; worker-src 'none'" };
    res.setHeader('Content-Security-Policy',policies[url.searchParams.get('mode')]);
    res.setHeader('Content-Type','text/javascript'); res.end(worker);
  } else if (url.pathname === '/module.js') {
    res.setHeader('Content-Type','text/javascript'); res.end('export const value = 17;');
  } else if(url.pathname === '/child.js') {
    res.setHeader('Content-Type','text/javascript'); res.end('postMessage("ready");');
  } else { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><title>CSP discriminator</title>'); }
});
let browser;
try {
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  browser = await chromium.launch();
  const result = {node:process.version, playwright:require('@playwright/test/package.json').version, chromium:browser.version(), cases:[]};
  for(const mode of ['plain','wasm','eval','nested']) {
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const checks = await page.evaluate(mode => new Promise(resolve => {
      const w = new Worker('/parent.js?mode='+mode,{type:'module'});
      const timer = setTimeout(() => {w.terminate();resolve('timeout');},4000);
      w.onmessage = e => {clearTimeout(timer);w.terminate();resolve(e.data);};
      w.onerror = e => {e.preventDefault();clearTimeout(timer);w.terminate();resolve('parent-error');};
    }),mode);
    result.cases.push({mode,checks}); await context.close();
  }
  await writeFile('/tmp/rifty-pr340-csp-probe.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
```
