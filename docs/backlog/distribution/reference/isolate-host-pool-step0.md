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
