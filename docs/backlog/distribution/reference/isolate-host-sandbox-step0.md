# isolate-host live sandbox — step 0 probes (2026-11-22)

Live-sandbox goal FIT evidence (the goal closed 2026-11-23; ADR-0568). Apple M3 Pro, macOS 26.6.2 arm64,
Node v24.16.0, isolated-vm 7.0.2, tree 50c9d8bf1. Throwaway scripts run from
`packages/isolate-host` (so `isolated-vm` resolves), removed after the run.

## S1 — where memory blow-ups end (decides the state model)

One isolate, `memoryLimit: 64`, a 25 ms poller that disposes the isolate when the
process RSS passes 256 + 3 × 64 MiB (ADR-0563's solo ceiling). Script body:

```js
const iso = new ivm.Isolate({ memoryLimit: 64, onCatastrophicError: (m) => { console.log(which, 'CATASTROPHIC', m); process.exit(9) } });
const ctx = await iso.createContext();
const t = setInterval(() => { const r = process.memoryUsage.rss(); peak = Math.max(peak, r);
  if (iso.isDisposed && why === 'none') why = 'ivm-disposed';
  if (r > CEIL && !iso.isDisposed) { why = 'rss'; iso.dispose(); } }, 25);
try { await ctx.eval(code, { timeout: 20000 }); } catch (e) { if (why === 'none') why = String(e).slice(0, 60); }
// 500 ms later: print why, peak RSS, RSS after
```

```
heapPush  ('const a=[]; for(;;) a.push({x:Math.random(), s:"y".repeat(100)})')  heap-limit dispose  peak 156  after 150 MiB
wasm      (WebAssembly.Memory grow 256 pages in a loop, filled)                 rss → dispose        peak 450  after  50 MiB
intl      ('for(;;) a.push(new Intl.DateTimeFormat("en",{timeZone:"UTC"}))')     rss → dispose        peak 458  after 458 MiB
strings   ("for(;;) s.push('x'.repeat(1e6)+Math.random())")                     heap-limit dispose  peak 155  after 152 MiB
typed     ('for(;;) a.push(new Float64Array(1e6))')                             RangeError: Array buffer allocation failed (catchable, isolate alive)
arrPush   ('const a=[]; for(;;) a.push(1.5)')                                   heap-limit dispose  peak 158  after  54 MiB
bigArray  ('new Array(2 ** 28).fill(0)')                                        CATASTROPHIC Catastrophic out-of-memory error (dispose at the crossing did not stop it: "Script failed to terminate")
```

Reading: a guest's memory blow-up can end in V8's unrecoverable catastrophic
error (the worker process must die) or leave the worker's RSS above its ceiling
after the isolate is gone (ICU). State held in the worker process does not
survive "the model's code ate memory". ArrayBuffer allocations count against
`memoryLimit` (separate probe: 40 × 16 MiB and one 1 GiB `ArrayBuffer` at limit
64 → `RangeError: Array buffer allocation failed`, isolate alive; wasm memory
does not count: 640 MiB grown, RSS back to 52 MiB after dispose).

## S2 — bytes across an `ivm.Callback` copy the whole backing buffer

```js
await ctx.global.set('hostWrite', new ivm.Callback((b) => { seen = { len: b.byteLength, off: b.byteOffset, buf: b.buffer.byteLength } }));
await ctx.global.set('hostRead', new ivm.Callback(() => new Uint8Array(64 << 20).subarray(5, 15)));
// guest: const big = new Uint8Array(256 << 20); for (100×) hostWrite(big.subarray(3, 13))
```

```
write view x100 ms 3585.1 { ctor: 'Uint8Array', len: 10, off: 3, buf: 268435456 }
read view x100 ms 1079.7 [10,5,67108864]
10k small calls ms 286.3
```

A 10-byte view crosses with its 256 MiB buffer (36 ms per call) in both
directions; a call costs ~28 µs.

## S3 — `node <path>` in the isolate today (rifty's program entry, MemoryFs)

Spike: a `runFile(files, path, argv)` beside `run` in `src/guest/entry.ts`
(`runNodeEntry({vfs: syncMirror(), entryPath, cwd: '/workspace'})` → `awaitDrain`
→ `exit`, as `run`), driven by the README minimal embedder; oracle `node <rel path>`
in a fresh realpath'd temp dir, `env: {}`, the temp dir replaced by `/workspace`.
Spike reverted. Same: JSON require, `process.exitCode` with a pending timer, fs
binary write/read/readdir. Different:

```
basic (require('./lib/x'), __filename, __dirname, argv, require.main === module, cwd)
  rifty: 42 /workspace/main.js /workspace [ '/workspace/main.js', 'a', 'b' ] false /workspace
  node : 42 /workspace/main.js /workspace [\n  '/workspace/main.js',\n  'a',\n  'b'\n] true /workspace
throwTop ('const a = 1;\nfoo();\n')
  rifty: ReferenceError: foo is not defined\n    at Object.eval (/workspace/main.js:4:1)\n    at compileCjsSource (<isolated-vm>:128790:8) …   exit 1
  node : /workspace/main.js:2\nfoo();\n^\n\nReferenceError: foo is not defined\n    at Object.<anonymous> (/workspace/main.js:2:1)\n    at Module._compile (node:internal/…) …\n\nNode.js v24.16.0   exit 1
throwDep (dep.js throws TypeError at line 1)
  rifty: TypeError: bad thing\n    at f (/workspace/dep.js:3:22)\n    at Object.eval (/workspace/dep.js:4:1) … at Object.eval (/workspace/main.js:3:1)
  node : /workspace/dep.js:1\n<source>\n<caret>\n\nTypeError: bad thing\n    at f (/workspace/dep.js:1:22)\n    at Object.<anonymous> (/workspace/dep.js:2:1) … at Object.<anonymous> (/workspace/main.js:1:1)
syntaxTop ('const a = ;')
  rifty: ModuleLoadError: Failed to compile CJS module /workspace/main.js: Unexpected token ';'\n    at compileCjsSource (<isolated-vm>…)
  node : /workspace/main.js:1\nconst a = ;\n          ^\n\nSyntaxError: Unexpected token ';'\n    at wrapSafe (node:internal/…)
syntaxDep (dep.js 'let x = {')
  rifty: ModuleLoadError: Failed to compile CJS module /workspace/dep.js: Unexpected token ')'
  node : /workspace/dep.js:2\n\n\n\nSyntaxError: Unexpected end of input
missingEntry / missingDep
  rifty: Error: Cannot find module '/workspace/nope.js'\n{\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}
  node : node:internal/modules/cjs/loader:1503\n  throw err;\n  ^\n\nError: Cannot find module '/workspace/nope.js'\n    at Module._resolveFilename (…) … {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v24.16.0
asyncReject (async main throws)
  rifty: Error: boom\n    at main (/workspace/main.js:3:31) …   (no header, +2 lines)
esm (main.mjs importing x.mjs)
  rifty: TypeError: URLConstructor is not a constructor\n    at fileURLFromResolvedPath (<isolated-vm>…)   exit 1
  node : 7 file:///workspace/main.mjs   exit 0
```

Node 24 also runs ESM syntax in a typeless `main.js` (detect-module):
`import fs from 'fs'; console.log(typeof fs.readFileSync)` → `function`, exit 0.

Reading: rifty's CJS factory shifts every position by its two wrapper lines
(draft `runtime-js/cjs-wrapper-stack-positions`), prints no source header,
caret or `Node.js v…` footer, wraps a compile `SyntaxError` as `ModuleLoadError`,
leaves `require.main` unset; its ESM loader needs `URL`, a declared ceiling.

## S4 — cost of a worker per exec

`node packages/isolate-host/p4-probe.mjs` (built `dist/index.js`, 50c9d8bf1):
first `runCode('1')` of a consumer (spawn + uncached compile) 192 / 187 ms;
warm p50 25.5 / 26.2 ms (10 sequential).
