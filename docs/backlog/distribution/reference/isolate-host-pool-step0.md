# isolate-host worker pool — step 0 premise probes (2026-11-18)

Goal `isolate-host-worker-pool` FIT evidence. Throwaway prototype outside the repo
(sources below, verbatim): one long-lived `node --no-node-snapshot` process, a fresh
isolated-vm isolate + the built `dist/guest.js` per call (bridge as `src/child/main.ts`
@ 4018de0fc minus limits/framing). Apple M3 Pro, macOS 26 arm64, 12 cores,
Node v24.16.0, isolated-vm 7.0.2, guest bundle built from 4018de0fc.

## Commands and output

`node --no-node-snapshot worker.mjs <pkg>` (code cache on in the concurrency rows):

```
warm worker, code cache off: p50 59.8 ms, p90 63.9 ms, max 76.2 ms (20 sequential, console.log(1))
warm worker, code cache on : p50 13.0 ms, p90 13.3 ms, max 14.1 ms (20 sequential, console.log(1))
worker at rest after warm-up: 141 MiB RSS (code cache on below)
 1 concurrent: peak 143 MiB RSS (+3 over 141 before → 2.8 MiB/isolate), 530 ms wall
 2 concurrent: peak 165 MiB RSS (+23 over 142 before → 11.5 MiB/isolate), 534 ms wall
 4 concurrent: peak 208 MiB RSS (+46 over 162 before → 11.5 MiB/isolate), 524 ms wall
 8 concurrent: peak 296 MiB RSS (+93 over 203 before → 11.7 MiB/isolate), 528 ms wall
16 concurrent: peak 468 MiB RSS (+183 over 285 before → 11.4 MiB/isolate), 546 ms wall
32 concurrent: peak 813 MiB RSS (+367 over 446 before → 11.5 MiB/isolate), 585 ms wall
after all: 770 MiB RSS
```

`node --no-node-snapshot worker.mjs <pkg> nocache`:

```
 2 concurrent: peak 196 MiB RSS (+55 over 141 before → 27.3 MiB/isolate), 597 ms wall
 4 concurrent: peak 302 MiB RSS (+109 over 193 before → 27.1 MiB/isolate), 610 ms wall
 8 concurrent: peak 494 MiB RSS (+198 over 296 before → 24.7 MiB/isolate), 612 ms wall
16 concurrent: peak 911 MiB RSS (+428 over 483 before → 26.7 MiB/isolate), 723 ms wall
after all: 1523 MiB RSS
```

A baseline, same machine, same build: `cd packages/isolate-host && node scripts/measure.mjs`:

```
runCode('console.log(1)'): p50 137 ms, max 177 ms (10 sequential)
one child at rest: 143 MiB peak RSS
8 concurrent: 1118 MiB peak child RSS, 703 ms wall
```

Retention, not a leak — `node --no-node-snapshot leak.mjs <pkg> <mode> <conc> <rounds>`
(RSS MiB after round): RSS stays at the high-water mark after `dispose()` and does not grow.

```
cache conc=1: 1:138 21:141 41:143 61:143 81:145 101:146 121:146 141:146 161:142 181:140 200:141
cache conc=8: 1:487 5:495 9:497 13:502 17:502 21:503 25:503 29:503 33:504 37:504 40:504
nocache conc=1: 1:137 11:139 21:140 31:141 41:142 51:142 61:142 71:142 81:143 91:144 100:142
```

Termination — `probe-term.mjs`: guest running 700 ms, then `isolate.dispose()`; time
until its run settles; a concurrent neighbour (`setTimeout(…, 1500)`) in the same process.

```
busy: dispose→settle 0.1 ms — rejected: Isolate was disposed during execution | neighbour {"exitCode":0,"stdout":"n\n"}
atomicsWaitForever: dispose→settle 0.2 ms — rejected | neighbour ok
regexBacktrack: dispose→settle 0.1 ms — rejected | neighbour ok
hugeSort (3e6 doubles, default comparator, for(;;)): dispose→settle 4739.4 ms — rejected | neighbour ok
hugeSort10m: ivm memory-limit disposal before 700 ms; run NOT SETTLED in 10 s | neighbour ok
bigJoin / jsonBig / microtaskLoop: 0.1 / 0.2 / 13.7 ms | neighbour ok
```

Memory attribution — `probe-mem.mjs <pkg> <case>`: 3 idle neighbours + 1 culprit, all
`memoryLimit: 64`, one process; RSS and per-isolate `used_heap_size + externally_allocated_size`
(MiB) sampled every 25 ms; "crossed" = first sample over base + 256 MiB.

```
heapGrowth:   crossed null; max RSS 258; culprit rejected "disposed … due to memory limit"; neighbours n,n,n
arrayBuffers: crossed null; max RSS 197; culprit exit 1 (RangeError); neighbours n,n,n
strings:      crossed null; max RSS 253; culprit disposed (memory limit); neighbours n,n,n
wasmGrow:     crossed null; max RSS 197; culprit exit 1; neighbours n,n,n
bufferAlloc:  crossed null; max RSS 238; culprit exit 1; neighbours n,n,n
catastrophic (new Array(2**28).fill(0)): crossed at 817 ms, rss 488, stats "0=18 1=18 2=18 C=disposed"; max RSS 1354; culprit unsettled; onCatastrophicError not fired in 8 s; neighbours n,n,n
timerFlood (20000 × setInterval(f, 1)): crossed at 230 ms, rss 395, stats "0=17 1=17 2=17 C=21"; max RSS 1882; culprit unsettled; neighbours n,n,n
```

Guest timer/SAB surface, current `runCode` (one child per call):

```
typeof SharedArrayBuffer, Atomics, WebAssembly → function object object
Atomics.wait(ia, 0, 0, 50) → 'timed-out' after 55 ms
performance.now() smallest positive delta: 0.00333 ms (guest) vs 0.000041 ms (node -e, same machine)
Date.now() smallest delta: 1 ms
```

isolated-vm thread pool: `src/isolate/scheduler.cc:12` `thread_pool_t thread_pool{std::thread::hardware_concurrency() + 1};`

Rival route "A + code cache" — `node a-cache.mjs <pkg>` (spawn per call, guest compiled from a V8 cache file
produced by the first run; `oneshot.mjs` reports its RSS at the result):

```
A + code cache: p50 74.5 ms, max 80.3 ms (10 sequential spawn→exit); child RSS at result 108 MiB max
```

Retention after one big legit call — `node --no-node-snapshot probe-retain.mjs <pkg>` (memoryLimit 1536,
RSS 1 s after `dispose()`; worker at rest 138 MiB): one 7e7-element array returns its memory, many small
objects do not.

```
"70000000\n" 0 rss after dispose + 1 s: 141
"8000000\n" 0 rss after dispose + 1 s: 651
```
(6e6 objects at limit 1024: 525 MiB; 3e6: 338 MiB.)

RSS vectors re-run on the landed pool (2026-11-19, after the interval backpressure; `node probe-pool-rss.mjs
<pkg>/dist/index.js`, 3 neighbours + culprit on one worker, `memoryLimitMb` 64; the "workers seen" column of
the run counted `ps` itself and is dropped):

```
timerFlood: culprit null/timeout; neighbours n0,n1,n2; peak worker RSS 365 MiB
catastrophic: culprit null/memory; neighbours n0,n1,n2; peak worker RSS 810 MiB
heapGrowth: culprit null/memory; neighbours n0,n1,n2; peak worker RSS 262 MiB
arrayBuffers: culprit 1/undefined; neighbours n0,n1,n2; peak worker RSS 244 MiB
wasmGrow: culprit 1/undefined; neighbours n0,n1,n2; peak worker RSS 227 MiB
```

No vector crosses the worker ceiling without an isolate signal: the RSS-kill-without-culprit path is
recorded unreachable for these vectors (goal map fog).

Guest memory outside the isolate heap (2026-11-19, cross-review round 1). `node --no-node-snapshot probe-wasm.mjs <pkg>`:
`WebAssembly.Memory` grown 30 × 160 pages with every page written, `memoryLimit` 64 — the isolate's own stats
do not see it, and it is not disposed:

```
302 ms rss 236 used 2 total 4 physical 3 external 13 malloced 1 peakMalloced 1 limit 67
903 ms rss 408 used 2 total 4 physical 3 external 13 malloced 1 peakMalloced 2 limit 67
3004 ms rss 441 used 3 total 4 physical 3 external 13 malloced 1 peakMalloced 2 limit 67
result {"exitCode":0,"stdout":""}
```

`node --no-node-snapshot probe-offheap.mjs <pkg>` (each vector writes its pages; `memoryLimit` 64; peak RSS over base):

```
sab: exit 1 ""; peak RSS +48 MiB over base                 (fixed SharedArrayBuffer: counted, RangeError)
sabGrowable: exit 0 "len 640"; peak RSS +637 MiB over base (maxByteLength: NOT counted)
resizableAB: exit 0 "len 640"; peak RSS +593 MiB over base (maxByteLength: NOT counted)
manyResizable: exit 0 "kept 40"; peak RSS +581 MiB over base
plainAB: exit 1 ""; peak RSS +4 MiB over base              (counted)
bigString: exit 0 "kept 40"; peak RSS +4 MiB over base     (on-heap; ropes)
wasmWritten: exit 0 "pages 10241"; peak RSS +607 MiB over base (NOT counted)
```

Engine knobs (`node --v8-options`, Node v24.16.0): no flag removes `WebAssembly` short of `--jitless` (`--expose-wasm`
is gone); `--wasm-max-mem-pages=0` makes `new WebAssembly.Memory({initial: 1})` throw "could not allocate memory" and
`grow` throw "Unable to grow instance memory" in every isolate of the process; no flag disables `maxByteLength`.
A realm wrapper refusing `maxByteLength` (`probe-rab-wrap.mjs`): the direct, `prototype.constructor`, subclass,
`Reflect.construct` new-target and species paths all reach the refusal; no stack frame hands out the original;
`transfer(16 MiB)` × 40 goes through the counted allocator ("Array buffer allocation failed").

Not measured: Intl/ICU data and caches, compiled-code space, regexp code (V8 heap spaces, likely counted; unproven).

## Prototype sources

### `lib.mjs`

```js
// Throwaway prototype (goal isolate-host-worker-pool, step 0): one long-lived
// process, a fresh isolated-vm isolate + rifty guest bundle per call.
// Usage: node --no-node-snapshot worker.mjs <package-dir>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const pkg = process.argv[2];
const require = createRequire(`${pkg}/package.json`);
const ivm = require('isolated-vm');
const guestSource = readFileSync(`${pkg}/dist/guest.js`, 'utf8');
let cachedData;

export function startOne(code, { cache, memoryLimit = 256, onCatastrophicError } = {}) {
  const isolate = new ivm.Isolate({ memoryLimit, onCatastrophicError });
  return { isolate, done: runIn(isolate, code, { cache }) };
}
export async function runOne(code, opts) { return startOne(code, opts).done; }
async function runIn(isolate, code, { cache }) {
  const out = [];
  let rejection, fireRef;
  const timers = new Map();
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    const bridge = {
      write: (fd, bytes) => { out.push([fd, Buffer.from(bytes)]); },
      timerStart: (id, ms, repeat) => {
        const t = timers.get(id); if (t) clearTimeout(t);
        const tick = () => { if (!repeat) timers.delete(id); fireRef?.applyIgnored(undefined, [id]); };
        timers.set(id, repeat ? setInterval(tick, ms) : setTimeout(tick, ms));
      },
      timerClear: (id) => { const t = timers.get(id); if (t) clearTimeout(t); timers.delete(id); },
      now: () => performance.now(),
      random: (n) => new Uint8Array(randomBytes(n)),
    };
    const names = Object.keys(bridge);
    for (const [n, fn] of Object.entries(bridge)) await jail.set(`__riftyHost_${n}`, new ivm.Callback(fn));
    await context.eval(`{ const b = { timeOrigin: ${performance.timeOrigin}, uncopyableReason: 'x' };
      for (const n of ${JSON.stringify(names)}) { b[n] = globalThis['__riftyHost_' + n]; delete globalThis['__riftyHost_' + n]; }
      Object.defineProperty(globalThis, '__riftyIsolateHost', { value: Object.freeze(b), configurable: true }); }`);
    let script;
    if (cache && cachedData) {
      script = await isolate.compileScript(guestSource, { filename: 'g.js', cachedData });
      if (script.cachedDataRejected) throw new Error('cache rejected');
    } else {
      script = await isolate.compileScript(guestSource, { filename: 'g.js', produceCachedData: cache });
      if (cache) cachedData = script.cachedData;
    }
    await script.run(context);
    const guest = await jail.get('__riftyGuest', { reference: true });
    fireRef = await guest.get('fire', { reference: true });
    rejection = await guest.get('rejection', { reference: true });
    const start = await guest.get('run', { reference: true });
    const exitCode = await start.apply(undefined, [code], { arguments: { copy: true }, result: { promise: true, copy: true } });
    return { exitCode, stdout: out.filter(([fd]) => fd === 1).map(([, b]) => b.toString()).join('') };
  } finally {
    for (const t of timers.values()) clearTimeout(t);
    if (!isolate.isDisposed) isolate.dispose();
  }
}

export const setCachedData = (c) => { cachedData = c; };
export const getCachedData = () => cachedData;
```

### `worker.mjs`

```js
// Throwaway prototype (goal isolate-host-worker-pool, step 0): one long-lived
// process, a fresh isolated-vm isolate + rifty guest bundle per call.
// Usage: node --no-node-snapshot worker.mjs <package-dir>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const pkg = process.argv[2];
const require = createRequire(`${pkg}/package.json`);
const ivm = require('isolated-vm');
const guestSource = readFileSync(`${pkg}/dist/guest.js`, 'utf8');
let cachedData;

async function runOne(code, { cache }) {
  const isolate = new ivm.Isolate({ memoryLimit: 256 });
  const out = [];
  let rejection, fireRef;
  const timers = new Map();
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    const bridge = {
      write: (fd, bytes) => { out.push([fd, Buffer.from(bytes)]); },
      timerStart: (id, ms, repeat) => {
        const t = timers.get(id); if (t) clearTimeout(t);
        const tick = () => { if (!repeat) timers.delete(id); fireRef?.applyIgnored(undefined, [id]); };
        timers.set(id, repeat ? setInterval(tick, ms) : setTimeout(tick, ms));
      },
      timerClear: (id) => { const t = timers.get(id); if (t) clearTimeout(t); timers.delete(id); },
      now: () => performance.now(),
      random: (n) => new Uint8Array(randomBytes(n)),
    };
    const names = Object.keys(bridge);
    for (const [n, fn] of Object.entries(bridge)) await jail.set(`__riftyHost_${n}`, new ivm.Callback(fn));
    await context.eval(`{ const b = { timeOrigin: ${performance.timeOrigin}, uncopyableReason: 'x' };
      for (const n of ${JSON.stringify(names)}) { b[n] = globalThis['__riftyHost_' + n]; delete globalThis['__riftyHost_' + n]; }
      Object.defineProperty(globalThis, '__riftyIsolateHost', { value: Object.freeze(b), configurable: true }); }`);
    let script;
    if (cache && cachedData) {
      script = await isolate.compileScript(guestSource, { filename: 'g.js', cachedData });
      if (script.cachedDataRejected) throw new Error('cache rejected');
    } else {
      script = await isolate.compileScript(guestSource, { filename: 'g.js', produceCachedData: cache });
      if (cache) cachedData = script.cachedData;
    }
    await script.run(context);
    const guest = await jail.get('__riftyGuest', { reference: true });
    fireRef = await guest.get('fire', { reference: true });
    rejection = await guest.get('rejection', { reference: true });
    const start = await guest.get('run', { reference: true });
    const exitCode = await start.apply(undefined, [code], { arguments: { copy: true }, result: { promise: true, copy: true } });
    return { exitCode, stdout: out.filter(([fd]) => fd === 1).map(([, b]) => b.toString()).join('') };
  } finally {
    for (const t of timers.values()) clearTimeout(t);
    isolate.dispose();
  }
}

const mib = (b) => Math.round(b / 1048576);
const peakDuring = async (work) => {
  let peak = process.memoryUsage.rss();
  const s = setInterval(() => { peak = Math.max(peak, process.memoryUsage.rss()); }, 5);
  const t0 = performance.now();
  try { await work(); } finally { clearInterval(s); }
  peak = Math.max(peak, process.memoryUsage.rss());
  return { peak, wall: performance.now() - t0 };
};
const p = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))]; };

const first = await runOne('console.log(6*7)', { cache: false });
if (first.stdout !== '42\n' || first.exitCode !== 0) throw new Error(JSON.stringify(first));
for (const cache of [false, true]) {
  for (let i = 0; i < 3; i++) await runOne('console.log(1)', { cache });
  const ts = [];
  for (let i = 0; i < 20; i++) { const t0 = performance.now(); await runOne('console.log(1)', { cache }); ts.push(performance.now() - t0); }
  console.log(`warm worker, code cache ${cache ? 'on ' : 'off'}: p50 ${p(ts, 0.5).toFixed(1)} ms, p90 ${p(ts, 0.9).toFixed(1)} ms, max ${Math.max(...ts).toFixed(1)} ms (20 sequential, console.log(1))`);
}
const cache = process.argv[3] !== 'nocache';
await new Promise((r) => setTimeout(r, 300));
const base = process.memoryUsage.rss();
console.log(`worker at rest after warm-up: ${mib(base)} MiB RSS (code cache ${cache ? 'on' : 'off'} below)`);
for (const n of [1, 2, 4, 8, 16, 32]) {
  const before = process.memoryUsage.rss();
  const { peak, wall } = await peakDuring(() => Promise.all(Array.from({ length: n }, () => runOne('setTimeout(() => {}, 500)', { cache }))));
  await new Promise((r) => setTimeout(r, 200));
  console.log(`${String(n).padStart(2)} concurrent: peak ${mib(peak)} MiB RSS (+${mib(peak - before)} over ${mib(before)} before → ${((peak - before) / n / 1048576).toFixed(1)} MiB/isolate), ${Math.round(wall)} ms wall`);
}
if (globalThis.gc) gc();
await new Promise((r) => setTimeout(r, 500));
console.log(`after all: ${mib(process.memoryUsage.rss())} MiB RSS`);
console.log(`node ${process.version} ${process.platform}/${process.arch}, isolated-vm ${require('isolated-vm/package.json').version}`);
```

### `leak.mjs`

```js
// Usage: node --no-node-snapshot leak.mjs <package-dir> <cache|nocache> <concurrency> <rounds>
import { runOne } from './lib.mjs';
const [, , , mode, conc, rounds] = process.argv;
const cache = mode === 'cache';
const mib = (b) => Math.round(b / 1048576);
const row = [];
for (let r = 0; r < Number(rounds); r++) {
  await Promise.all(Array.from({ length: Number(conc) }, () => runOne('setTimeout(() => {}, 50)', { cache })));
  if (r % Math.max(1, Math.floor(rounds / 10)) === 0 || r === rounds - 1) row.push(`${r + 1}:${mib(process.memoryUsage.rss())}`);
}
console.log(`${mode} conc=${conc}: RSS MiB after round → ${row.join(' ')}`);
```

### `probe-term.mjs`

```js
// Usage: node --no-node-snapshot probe-term.mjs <pkg>. Dispose a running guest; time until its run settles.
import { startOne, runOne } from './lib.mjs';
await runOne('1', { cache: true });
const cases = {
  busy: 'for(;;){}',
  atomicsWaitForever: 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)',
  regexBacktrack: "/(a+)+$/.test('a'.repeat(40) + '!')",
  hugeSort: 'const a = Array.from({length: 3e6}, () => Math.random()); for(;;) a.sort()',
  hugeSort10m: 'const a = Array.from({length: 1e7}, () => Math.random()); for(;;) a.sort()',
  bigJoin: "for(;;) new Array(5e7).join('x')",
  repeatStr: "for(;;) 'ab'.repeat(2**28).indexOf('c')",
  jsonBig: 'const o = Array.from({length: 2e6}, (_, i) => ({i})); for(;;) JSON.stringify(o)',
  microtaskLoop: 'const f = () => Promise.resolve().then(f); f()',
};
for (const [name, code] of Object.entries(cases)) {
  const neighbour = startOne('setTimeout(() => console.log("n"), 1500)', { cache: true });
  const { isolate, done } = startOne(code, { cache: true });
  await new Promise((r) => setTimeout(r, 700));
  const t0 = performance.now();
  if (!isolate.isDisposed) isolate.dispose(); else console.log(name + ": already disposed (memory limit) before 700 ms");
  const outcome = await Promise.race([done.then((v) => 'resolved ' + JSON.stringify(v), (e) => 'rejected: ' + e.message), new Promise((r) => setTimeout(() => r('NOT SETTLED in 10 s'), 10000))]);
  const settled = performance.now() - t0;
  const n = await Promise.race([neighbour.done, new Promise((r) => setTimeout(() => r('neighbour hung'), 10000))]);
  console.log(`${name}: dispose→settle ${settled.toFixed(1)} ms — ${outcome.slice(0, 90)} | neighbour ${JSON.stringify(n)}`);
}
process.exit(0);
```

### `probe-mem.mjs`

```js
// Usage: node --no-node-snapshot probe-mem.mjs <pkg> <case>. 3 idle neighbours + 1 culprit, memoryLimit 64.
// Samples RSS and per-isolate heap stats every 25 ms; reports which isolate leads at the RSS crossing.
import { startOne, runOne } from './lib.mjs';
await runOne('1', { cache: true });
const cases = {
  catastrophic: 'new Array(2**28).fill(0)',
  heapGrowth: 'const a = []; for(;;) a.push({x: Math.random()})',
  arrayBuffers: 'const a = []; for(;;) a.push(new ArrayBuffer(8 << 20))',
  strings: "const a = []; for(let i=0;;i++) a.push('x'.repeat(1<<20) + i)",
  wasmGrow: 'const m = new WebAssembly.Memory({initial: 1, maximum: 65536}); for(;;) m.grow(160)',
  bufferAlloc: 'const a = []; for(;;) a.push(Buffer.alloc(8 << 20, 1))',
  timerFlood: 'for (let i = 0; i < 20000; i++) setInterval(() => {}, 1)',
  outputFlood: 'for(;;) process.stdout.write("x".repeat(65536))',
};
const name = process.argv[3];
const base = process.memoryUsage.rss();
const threshold = base + (256 << 20);
let catastrophic = [];
const guests = [0, 1, 2].map((i) => ({ i, ...startOne('setTimeout(() => console.log("n"), 4000)', { cache: true, memoryLimit: 64, onCatastrophicError: (m) => catastrophic.push(`n${i}:${m}`) }) }));
const culprit = { i: 'C', ...startOne(cases[name], { cache: true, memoryLimit: 64, onCatastrophicError: (m) => catastrophic.push(`C:${m}`) }) };
const all = [...guests, culprit];
const stat = (g) => { if (g.isolate.isDisposed) return 'disposed'; const s = g.isolate.getHeapStatisticsSync(); return Math.round((s.used_heap_size + s.externally_allocated_size) / 1048576); };
let crossed = null, maxRss = 0, settledC = null;
culprit.done.then((v) => { settledC = 'resolved ' + JSON.stringify(v); }, (e) => { settledC = 'rejected ' + e.message; });
const t0 = performance.now();
await new Promise((resolve) => {
  const iv = setInterval(() => {
    const rss = process.memoryUsage.rss(); maxRss = Math.max(maxRss, rss);
    if (!crossed && rss > threshold) crossed = { at: Math.round(performance.now() - t0), rss: Math.round(rss / 1048576), stats: all.map((g) => `${g.i}=${stat(g)}`).join(' ') };
    if (settledC || crossed && performance.now() - t0 > 3000 || performance.now() - t0 > 8000) { clearInterval(iv); resolve(); }
  }, 25);
});
const neighbours = await Promise.race([Promise.allSettled(guests.map((g) => g.done)), new Promise((r) => setTimeout(() => r('neighbours hung 6 s'), 6000))]);
console.log(`${name}: base ${Math.round(base/1048576)} MiB, threshold +256 → crossed ${JSON.stringify(crossed)}; max RSS ${Math.round(maxRss/1048576)} MiB; culprit ${settledC ?? 'unsettled'}; catastrophic [${catastrophic}]; neighbours ${JSON.stringify(Array.isArray(neighbours) ? neighbours.map((n) => n.status === 'fulfilled' ? n.value.stdout.trim() : n.reason.message) : neighbours)}`);
process.kill(process.pid, 'SIGKILL');
```

### `oneshot.mjs`

```js
// Usage: node --no-node-snapshot oneshot.mjs <pkg> <cache-file> — one process, one isolate, one call (A + V8 code cache).
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const [, , pkg, cacheFile] = process.argv;
const ivm = createRequire(`${pkg}/package.json`)('isolated-vm');
const { runOne, setCachedData, getCachedData } = await import('./lib.mjs');
if (existsSync(cacheFile)) setCachedData(new ivm.ExternalCopy(readFileSync(cacheFile).buffer.slice(0)));
const r = await runOne('console.log(1)', { cache: true });
if (!existsSync(cacheFile)) writeFileSync(cacheFile, Buffer.from(getCachedData().copy()));
if (r.stdout !== '1\n') throw new Error(JSON.stringify(r));
process.stdout.write(String(process.memoryUsage.rss()));
process.kill(process.pid, 'SIGKILL');
```

### `a-cache.mjs`

```js
// Usage: node a-cache.mjs <pkg> — A with a V8 code cache: spawn per call, cached compile; wall + child peak RSS.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
const pkg = process.argv[2]; const cache = '/tmp/rifty-c-proto/guest.cache';
rmSync(cache, { force: true });
const once = () => new Promise((res) => { const t0 = performance.now(); const c = spawn(process.execPath, ['--no-node-snapshot', '/tmp/rifty-c-proto/oneshot.mjs', pkg, cache]); let out = ''; c.stdout.on('data', (d) => out += d); c.on('exit', () => res({ ms: performance.now() - t0, rss: Number(out) / 1048576 })); });
await once();
const rs = []; for (let i = 0; i < 10; i++) rs.push(await once());
const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
console.log(`A + code cache: p50 ${ms[4].toFixed(1)} ms, max ${ms.at(-1).toFixed(1)} ms (10 sequential spawn→exit); child RSS at result ${Math.round(Math.max(...rs.map((r) => r.rss)))} MiB max`);
```

### `probe-retain.mjs`

```js
// Usage: node --no-node-snapshot probe-retain.mjs <pkg> — RSS retained by a worker after one big legit call.
import { runOne } from './lib.mjs';
const mib = () => Math.round(process.memoryUsage.rss() / 1048576);
await runOne('1', { cache: true });
console.log('rest', mib());
for (const code of ['const a = new Array(7e7).fill(1.5); console.log(a.length)', 'const a = []; for (let i = 0; i < 8e6; i++) a.push({ i, s: "k" + i }); console.log(a.length)']) {
  const r = await runOne(code, { cache: true, memoryLimit: 1536 });
  await new Promise((r) => setTimeout(r, 1000));
  console.log(JSON.stringify(r.stdout), r.exitCode, 'rss after dispose + 1 s:', mib());
}
```

### `probe-pool-rss.mjs`

```js
// Usage: node probe-pool-rss.mjs <pkg>/dist/index.js — step-0 RSS vectors on the landed pool: 3 neighbours + culprit,
// peak worker RSS, whether the worker was lost (pid set changed), culprit result.
import { execFileSync } from 'node:child_process';
const { runCode } = await import(process.argv[2]);
const kids = () => execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' }).split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter(([p, pp]) => pp === process.pid && p !== undefined);
const cases = {
  timerFlood: ['for (let i = 0; i < 20000; i++) setInterval(() => {}, 1)', { timeoutMs: 3000, memoryLimitMb: 64 }],
  catastrophic: ['new Array(2**28).fill(0)', { memoryLimitMb: 64, timeoutMs: 20000 }],
  heapGrowth: ['const a = []; for(;;) a.push({x: Math.random()})', { memoryLimitMb: 64, timeoutMs: 20000 }],
  arrayBuffers: ['const a = []; for(;;) a.push(new ArrayBuffer(8 << 20))', { memoryLimitMb: 64, timeoutMs: 20000 }],
  wasmGrow: 'const m = new WebAssembly.Memory({initial: 1, maximum: 65536}); for(;;) m.grow(160)',
};
await runCode('1');
for (const [name, c] of Object.entries(cases)) {
  const [code, opts] = Array.isArray(c) ? c : [c, { memoryLimitMb: 64, timeoutMs: 20000 }];
  const before = kids().map(([p]) => p);
  let peak = 0; const pids = new Set();
  const t = setInterval(() => { for (const [p, , r] of kids()) { pids.add(p); peak = Math.max(peak, r / 1024); } }, 20);
  const ns = [0, 1, 2].map((i) => runCode(`setTimeout(() => console.log('n${i}'), 1500)`).then((r) => r.stdout.trim(), (e) => 'REJ ' + e.code));
  const culprit = await runCode(code, opts).then((r) => `${r.exitCode}/${r.termination}`, (e) => 'REJ ' + e.code);
  const n = await Promise.all(ns);
  clearInterval(t);
  console.log(`${name}: culprit ${culprit}; neighbours ${n.join(',')}; peak worker RSS ${Math.round(peak)} MiB; workers seen ${pids.size} (before ${before.length})`);
}
process.exit(0);
```

### `probe-wasm.mjs`

```js
// Usage: node --no-node-snapshot probe-wasm.mjs <pkg> — wasm memory with written pages: what the isolate's own stats report.
import { startOne, runOne } from './lib.mjs';
await runOne('1', { cache: true });
const code = `const m = new WebAssembly.Memory({ initial: 1, maximum: 65536 });
  let n = 0; const tick = () => { if (n++ >= 30) return; m.grow(160); const u = new Uint8Array(m.buffer); for (let i = 0; i < u.length; i += 4096) u[i] = 1; setTimeout(tick, 30); }; tick();
  setTimeout(() => {}, 3000);`;
const g = startOne(code, { cache: true, memoryLimit: 64 });
const mib = (b) => Math.round(b / 1048576);
const t0 = performance.now();
const iv = setInterval(() => {
  if (g.isolate.isDisposed) { console.log('disposed'); return; }
  const s = g.isolate.getHeapStatisticsSync();
  console.log(`${Math.round(performance.now() - t0)} ms rss ${mib(process.memoryUsage.rss())} used ${mib(s.used_heap_size)} total ${mib(s.total_heap_size)} physical ${mib(s.total_physical_size)} external ${mib(s.externally_allocated_size)} malloced ${mib(s.malloced_memory)} peakMalloced ${mib(s.peak_malloced_memory)} limit ${mib(s.heap_size_limit)}`);
}, 300);
console.log('result', JSON.stringify(await g.done.catch((e) => e.message)));
clearInterval(iv);
process.exit(0);
```

### `probe-offheap.mjs`

```js
// Usage: node --no-node-snapshot probe-offheap.mjs <pkg> — guest-controlled memory outside the isolate heap? memoryLimit 64,
// each vector writes its pages; reports peak process RSS over base, the guest's result, and isolate stats at the end.
import { startOne, runOne } from './lib.mjs';
await runOne('1', { cache: true });
const touch = 'for (let i = 0; i < u.length; i += 4096) u[i] = 1;';
const cases = {
  sab: `const a = []; for (let k = 0; k < 40; k++) { const u = new Uint8Array(new SharedArrayBuffer(16 << 20)); ${touch} a.push(u) } console.log('kept', a.length)`,
  sabGrowable: `const s = new SharedArrayBuffer(0, { maxByteLength: 1 << 30 }); for (let k = 1; k <= 40; k++) { s.grow(k * (16 << 20)); const u = new Uint8Array(s); ${touch} } console.log('len', s.byteLength >> 20)`,
  resizableAB: `const b = new ArrayBuffer(0, { maxByteLength: 1 << 30 }); for (let k = 1; k <= 40; k++) { b.resize(k * (16 << 20)); const u = new Uint8Array(b); ${touch} } console.log('len', b.byteLength >> 20)`,
  manyResizable: `const a = []; for (let k = 0; k < 40; k++) { const b = new ArrayBuffer(16 << 20, { maxByteLength: 1 << 30 }); const u = new Uint8Array(b); ${touch} a.push(b) } console.log('kept', a.length)`,
  plainAB: `const a = []; for (let k = 0; k < 40; k++) { const u = new Uint8Array(16 << 20); ${touch} a.push(u) } console.log('kept', a.length)`,
  bigString: `let s = 'x'; const a = []; for (let k = 0; k < 40; k++) { a.push('y'.repeat(16 << 20) + k) } console.log('kept', a.length)`,
  wasmWritten: `const m = new WebAssembly.Memory({ initial: 1, maximum: 65536 }); for (let k = 0; k < 40; k++) { m.grow(256); const u = new Uint8Array(m.buffer); ${touch} } console.log('pages', m.buffer.byteLength >> 16)`,
};
const mib = (b) => Math.round(b / 1048576);
for (const [name, code] of Object.entries(cases)) {
  await new Promise((r) => setTimeout(r, 300));
  const base = process.memoryUsage.rss();
  let peak = base;
  const g = startOne(code, { cache: true, memoryLimit: 64 });
  const iv = setInterval(() => { peak = Math.max(peak, process.memoryUsage.rss()); }, 10);
  const r = await Promise.race([g.done.then((v) => `exit ${v.exitCode} ${JSON.stringify(v.stdout.trim())}`, (e) => `rejected: ${e.message.slice(0, 50)}`), new Promise((res) => setTimeout(() => res('still running at 15 s'), 15000))]);
  clearInterval(iv);
  console.log(`${name}: ${r}; peak RSS +${mib(peak - base)} MiB over base`);
  if (!g.isolate.isDisposed) g.isolate.dispose();
}
process.exit(0);
```

### `probe-rab-wrap.mjs`

```js
// Usage: node --no-node-snapshot probe-rab-wrap.mjs <pkg> — a realm wrapper refusing maxByteLength: does any path
// reach the original constructor? Plus: does transfer() of a fixed buffer go through the limited allocator?
import { createRequire } from 'node:module';
const ivm = createRequire(`${process.argv[2]}/package.json`)('isolated-vm');
const iso = new ivm.Isolate({ memoryLimit: 64 });
const ctx = iso.createContextSync();
ctx.evalSync(`{
  for (const Original of [ArrayBuffer, SharedArrayBuffer]) {
    const name = Original.name;
    const construct = Reflect.construct;
    const Wrapper = function (length, options) {
      if (new.target === undefined) throw new TypeError("Constructor " + name + " requires 'new'");
      if (options !== undefined && options !== null && typeof options === 'object' && options.maxByteLength !== undefined)
        throw new Error('Not implemented: isolate-host.resizable-' + name);
      return construct(Original, [length], new.target);
    };
    Object.defineProperty(Wrapper, 'name', { value: name });
    Wrapper.prototype = Original.prototype;
    Object.defineProperty(Original.prototype, 'constructor', { value: Wrapper, writable: true, configurable: true });
    for (const k of Reflect.ownKeys(Original)) if (k !== 'prototype' && k !== 'length' && k !== 'name') Object.defineProperty(Wrapper, k, Object.getOwnPropertyDescriptor(Original, k));
    Object.defineProperty(globalThis, name, { value: Wrapper, writable: true, configurable: true });
  }
}`);
const attempts = {
  direct: 'new ArrayBuffer(1 << 20, { maxByteLength: 1 << 30 }).resizable',
  directSab: 'new SharedArrayBuffer(1 << 20, { maxByteLength: 1 << 30 }).growable',
  protoCtor: 'new (new Uint8Array(1).buffer.constructor)(16, { maxByteLength: 1 << 30 }).resizable',
  subclass: 'class X extends ArrayBuffer {}; new X(16, { maxByteLength: 1 << 30 }).resizable',
  reflectNewTarget: 'Reflect.construct(ArrayBuffer, [16, { maxByteLength: 1 << 30 }], function () {}).resizable',
  speciesSlice: 'const b = new ArrayBuffer(16); b.constructor = undefined; b.slice(0).resizable',
  stackGetFunction: `let got; Error.prepareStackTrace = (e, s) => { for (const f of s) { try { const fn = f.getFunction(); if (fn && fn.name === 'ArrayBuffer' && fn !== ArrayBuffer) got = fn } catch {} } return ''; };
    new ArrayBuffer({ valueOf() { new Error().stack; return 16 } }); got ? new got(16, { maxByteLength: 1 << 30 }).resizable : 'no original on the stack'`,
  instanceOk: 'new Uint8Array(4).buffer instanceof ArrayBuffer && new ArrayBuffer(4) instanceof ArrayBuffer && ArrayBuffer.isView(new Uint8Array(1))',
  transferBig: 'const a = []; for (let k = 0; k < 40; k++) a.push(new ArrayBuffer(16).transfer(16 << 20)); a.length',
};
for (const [k, c] of Object.entries(attempts)) {
  try { console.log(k, '→', ctx.evalSync(c)); } catch (e) { console.log(k, '→ throws', e.message.slice(0, 70)); }
}
console.log('rss MiB', Math.round(process.memoryUsage.rss() / 1048576));
```
