#!/usr/bin/env node --no-node-snapshot --expose-gc
/**
 * Lifecycle probe — three ways a sandbox lives, worker side, real isolated-vm + the real guest
 * bundle (+ `probe-guest.ts` + `life-guest.ts`), over the four-library template (npm ci of
 * `../isolate-library-probe/deps`). Arms:
 *   v1   — today (ADR-0568 + ADR-0572 F1 (a)): a fresh isolate per `exec`; the template copied in
 *          (one ivm copy of a once-made ExternalCopy) + index; the sandbox's state restored, run,
 *          captured (blob + reference rows) — the state lives outside the isolate.
 *   v1b  — v1 with the template read lazily through 2 host functions (ADR-0572 F1 (b), deferred).
 *   v2   — a live isolate per sandbox: context A holds the FS (LayeredFs over the template, copied
 *          in ONCE); every `exec` is a new context B (fresh realm, the bundle re-run from the
 *          isolate's compiled script) whose FsSync is a copying membrane onto A's `serve`.
 *   v2b  — v2 with the template read lazily from the worker (2 host functions), cached in A.
 *   v3   — the FS lives in the worker (Node realm: LayeredFs over the worker's one template);
 *          a fresh isolate per `exec`, every FsSync call one sync host call.
 *
 *   node --no-node-snapshot --expose-gc life.mjs <node_modules> [cost|conc|mem|heap|life|host|floor]...
 */
import { lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = fileURLToPath(new URL('../../../../..', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const tpl = join(here, '../isolate-host-sandbox-template-probes');
const guestPkg = join(repo, 'packages/isolate-guest');
const ivm = createRequire(join(repo, 'packages/isolate-host/package.json'))('isolated-vm');
const { createHostBridge } = await import(join(guestPkg, 'dist/index.js'));
const NM = process.argv[2];
if (!NM) throw new Error('usage: life.mjs <four-library node_modules> [sections]');
const SECTIONS = new Set(process.argv.slice(3).length ? process.argv.slice(3) : ['cost']);
const LAYERED = join(tpl, 'layered.ts');
const nodePaths = [join(guestPkg, 'node_modules')];
const log = (o) => console.log(JSON.stringify(o));
const load = () => loadavg()[0].toFixed(1);

// ---- bundles -----------------------------------------------------------------------------------
const bundleFile = join(tmpdir(), `life-guest-${process.pid}.js`);
await build({
  absWorkingDir: guestPkg,
  stdin: {
    contents: `${readFileSync(join(tpl, 'probe-guest.ts'), 'utf8')}\n${readFileSync(join(here, 'life-guest.ts'), 'utf8')}`.replaceAll(
      '__LAYERED__',
      LAYERED,
    ),
    resolveDir: join(guestPkg, 'src/guest'),
    loader: 'ts',
  },
  nodePaths,
  inject: ['src/guest/web-shim.ts'],
  ignoreAnnotations: true,
  outfile: bundleFile,
  bundle: true,
  target: 'es2022',
  logLevel: 'warning',
  legalComments: 'none',
  platform: 'browser',
  format: 'iife',
  external: ['node:module'],
});
const bundle = readFileSync(bundleFile, 'utf8');
rmSync(bundleFile);
const realmFile = join(tmpdir(), `life-realm-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `export { createMemoryFs } from '@riftydev/vfs/internal'; export { snapshotFs, restoreFs } from './src/snapshot.ts'; export { LayeredFs, templateLayer } from '${LAYERED}';`,
    resolveDir: guestPkg,
    loader: 'ts',
  },
  nodePaths,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: realmFile,
  logLevel: 'warning',
});
const { createMemoryFs, snapshotFs, restoreFs, LayeredFs, templateLayer } = await import(
  pathToFileURL(realmFile).href
);
rmSync(realmFile);

// ---- the template ------------------------------------------------------------------------------
const files = [];
(function walk(abs, rel) {
  for (const name of readdirSync(abs).sort()) {
    const p = join(abs, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, `${rel}/${name}`);
    else if (st.isFile() && !p.endsWith('/.package-lock.json'))
      files.push([`${rel}/${name}`, readFileSync(p)]);
  }
})(NM, '/node_modules');
const T0 = 1_700_000_000_000;
const TIMES = { mtimeMs: T0, atimeMs: T0, ctimeMs: T0, birthtimeMs: T0 };
const dirsOf = (fs) => {
  const dirs = new Set(['/']);
  for (const [p] of fs) {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) dirs.add(`/${parts.slice(0, i).join('/')}`);
  }
  return [...dirs].sort();
};
const pack = new Uint8Array(files.reduce((n, [, d]) => n + d.length, 0));
const rows = dirsOf(files)
  .filter((d) => d !== '/')
  .map((d) => [1, d, 0, 0, T0, T0, T0, T0]);
{
  let off = 0;
  for (const [p, d] of files) {
    pack.set(d, off);
    rows.push([2, p, off, d.length, T0, T0, T0, T0]);
    off += d.length;
  }
}
const index = JSON.stringify(rows);
const packCopy = new ivm.ExternalCopy(pack); // the worker's one copy, per identity
const nodeLower = templateLayer(pack, rows); // the worker's one index
const REFS = JSON.stringify([['/node_modules', 'lazy', '/node_modules', TIMES]]);
const MAXB = 1 << 30;
const OPTS = { template: null, maxBytes: MAXB };
function blobOf(list) {
  const { fsSync } = createMemoryFs();
  for (const d of dirsOf(list)) if (d !== '/') fsSync.mkdirSync(d, { recursive: true });
  for (const [p, d] of list) fsSync.writeFileSync(p, new Uint8Array(d));
  for (const p of [...dirsOf(list), ...list.map(([q]) => q)]) fsSync.restoreStatSync(p, TIMES);
  return snapshotFs(fsSync, OPTS);
}
const GEN = join(here, '../isolate-library-probe/gen');
const W = {
  empty: '',
  pdf: readFileSync(join(GEN, 'pdf.cjs'), 'utf8'),
  docx: readFileSync(join(GEN, 'docx.cjs'), 'utf8'),
  pptx: readFileSync(join(GEN, 'pptx.cjs'), 'utf8'),
  xlsx: readFileSync(join(GEN, 'xlsx.cjs'), 'utf8'),
};
const ownOf = (src, extra = []) =>
  blobOf([
    ['/workspace/main.js', Buffer.from(src)],
    ['/tmp/.keep', Buffer.alloc(0)],
    ...extra,
  ]);

// ---- host side of the template (v1b / v2b) and of the worker FS (v3) -------------------------
const tplFns = {
  get: (p) => {
    const e = nodeLower.get(p);
    if (!e) return null;
    // Exact bytes: ivm copies a view's whole backing buffer (step 0).
    return [e.dir ? 1 : 0, e.dir ? null : e.bytes.slice(), e.mtimeMs, e.atimeMs, e.ctimeMs, e.birthtimeMs];
  },
  children: (p) => [...nodeLower.children(p)],
};
function serveNode(fs, op, args) {
  try {
    const r = fs[op](...args);
    return { r: ArrayBuffer.isView(r) ? r.slice() : r };
  } catch (e) {
    return { e: typeof e?.code === 'string' ? e.code : 'EIO', path: e?.path ?? '', message: e?.message ?? '' };
  }
}

// ---- one realm: context + host bridge + the bundle ---------------------------------------------
async function realm(iso, script, sink) {
  const ctx = await iso.createContext();
  const g = {};
  const { functions, timeOrigin, close } = createHostBridge({
    write: (_fd, b) => sink.out.push(Buffer.from(b).toString()),
    fire: (id) =>
      g.fire.apply(undefined, [id], { timeout: sink.remaining() }).catch((e) => sink.fail(e)),
  });
  const names = Object.keys(functions);
  await ctx.evalClosure(
    `globalThis.__riftyIsolateHost = { timeOrigin: ${timeOrigin}, ${names.map((n, i) => `${n}: $${i}`).join(', ')} };`,
    names.map((n) => new ivm.Callback(functions[n])),
  );
  await script.run(ctx);
  const entry = await ctx.global.get('__riftyGuest', { reference: true });
  const life = await ctx.global.get('__life', { reference: true });
  const probe = await ctx.global.get('__probe', { reference: true });
  g.fire = await entry.get('fire', { reference: true });
  // Every Reference into this realm keeps it alive: all are released with the realm (`close`).
  const refs = [entry, life, probe, g.fire];
  const fn = async (obj, name) => {
    const f = await obj.get(name, { reference: true });
    refs.push(f);
    return f;
  };
  const closeAll = () => {
    close();
    // LEAK_REFS=1: the probe's first version — References into a run realm never released.
    if (process.env.LEAK_REFS === '1') return;
    for (const x of refs.splice(0)) {
      try {
        x.release();
      } catch {}
    }
  };
  return { ctx, entry, life, probe, close: closeAll, fn };
}
let cachedData;
async function compile(iso) {
  const s = await iso.compileScript(bundle, {
    filename: 'g.js',
    ...(cachedData ? { cachedData } : { produceCachedData: true }),
  });
  if (!cachedData) cachedData = s.cachedData;
  return s;
}
const sinkOf = (timeoutMs) => {
  const at = performance.now() + timeoutMs;
  const s = {
    out: [],
    failed: null,
    remaining: () => Math.max(1, Math.round(at - performance.now())),
    fail: (e) => {
      s.failed ??= e;
      s.onFail?.(e);
    },
  };
  return s;
};
/** runFile under a deadline: per-call ivm timeouts (sync work) + a host deadline (waiting). */
async function runFile(r, sink, path, args, timeoutMs) {
  const start = await r.fn(r.entry, 'runFile');
  const result = start.apply(undefined, [path, args], {
    arguments: { copy: true },
    result: { promise: true, copy: true },
    timeout: sink.remaining(),
  });
  let timer;
  const deadline = new Promise((res) => {
    timer = setTimeout(() => res({ termination: 'timeout', why: 'deadline' }), timeoutMs);
    sink.onFail = (e) => res({ termination: classify(e), why: String(e?.message ?? e).slice(0, 80) });
  });
  try {
    return await Promise.race([
      result.then(
        (code) => ({ code }),
        (e) => ({ termination: classify(e), why: String(e?.message ?? e).slice(0, 80) }),
      ),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const classify = (e) => {
  const m = String(e?.message ?? e);
  if (/timed out/i.test(m)) return 'timeout';
  if (/disposed|memory/i.test(m)) return 'memory';
  return `error`;
};

// ---- arms --------------------------------------------------------------------------------------
class Fresh {
  // v1 / v1b / v3: a fresh isolate per exec.
  constructor(kind, src, { limit = 1024, extra = [] } = {}) {
    this.kind = kind;
    this.limit = limit;
    this.blob = ownOf(src, extra);
    this.refs = REFS;
    if (kind === 'v3') {
      const up = createMemoryFs().fsSync;
      restoreFs(up, this.blob, OPTS);
      this.fs = LayeredFs.fromWire(nodeLower, up, JSON.parse(REFS));
    }
  }
  async exec({ args = ['/workspace/out.bin'], timeoutMs = 30_000 } = {}) {
    const t = { start: performance.now() };
    const sink = sinkOf(timeoutMs);
    const iso = new ivm.Isolate({ memoryLimit: this.limit });
    let r;
    try {
      const script = await compile(iso);
      r = await realm(iso, script, sink);
      t.boot = performance.now();
      if (this.kind === 'v3') {
        await r.ctx.global.set(
          '__lifeDispatch',
          new ivm.Callback((_epoch, op, a) => serveNode(this.fs, op, a)),
        );
        await (await r.fn(r.life, 'install')).apply(undefined, [true, 0]);
      } else {
        await (await r.fn(r.entry, 'restore')).apply(undefined, [this.blob, OPTS], {
          arguments: { copy: true },
        });
        if (this.kind === 'v1')
          await (await r.fn(r.probe, 'layered')).apply(
            undefined,
            [packCopy.copyInto(), index, this.refs],
            { arguments: { copy: true } },
          );
        else {
          await r.ctx.evalClosure('globalThis.__lifeTpl = { get: $0, children: $1 };', [
            new ivm.Callback(tplFns.get),
            new ivm.Callback(tplFns.children),
          ]);
          await (await r.fn(r.life, 'layeredRemote')).apply(undefined, [this.refs]);
        }
      }
      t.restore = performance.now();
      const res = await runFile(r, sink, '/workspace/main.js', args, timeoutMs);
      t.run = performance.now();
      if (this.kind !== 'v3' && 'code' in res) {
        const [blob, refs] = await (await r.fn(r.life, 'captureFull')).apply(undefined, [MAXB], {
          result: { copy: true },
        });
        this.blob = blob;
        this.refs = refs;
      }
      t.capture = performance.now();
      return {
        ...res,
        ms: t.capture - t.start,
        boot: t.boot - t.start,
        restore: t.restore - t.boot,
        runMs: t.run - t.restore,
        capture: t.capture - t.run,
        out: sink.out.join('').slice(0, 200),
      };
    } catch (e) {
      return { termination: classify(e), why: String(e?.message ?? e).slice(0, 120) };
    } finally {
      r?.close();
      if (!iso.isDisposed) iso.dispose();
    }
  }
  /** Host read of a file of the sandbox: v1 = consumer's own copy of the state, v3 = worker FS. */
  read(p) {
    if (this.kind === 'v3') return this.fs.readFileBytesSync(p);
    const up = createMemoryFs().fsSync;
    restoreFs(up, this.blob, OPTS);
    return LayeredFs.fromWire(nodeLower, up, JSON.parse(this.refs)).readFileBytesSync(p);
  }
  dispose() {}
}

class Live {
  // v2 / v2b: one isolate per sandbox, FS in context A, a fresh context B per exec.
  constructor(kind, src, { limit = 1024, extra = [], restorePoint = false } = {}) {
    this.kind = kind;
    this.src = src;
    this.limit = limit;
    this.extra = extra;
    this.restorePoint = restorePoint;
  }
  async create() {
    const t = performance.now();
    this.iso = new ivm.Isolate({ memoryLimit: this.limit });
    this.script = await compile(this.iso);
    this.A = await realm(this.iso, this.script, sinkOf(1e9));
    await (await this.A.fn(this.A.entry, 'restore')).apply(undefined, [ownOf(this.src, this.extra), OPTS], {
      arguments: { copy: true },
    });
    if (this.kind === 'v2')
      await (await this.A.fn(this.A.probe, 'layered')).apply(undefined, [packCopy.copyInto(), index, REFS], {
        arguments: { copy: true },
      });
    else {
      await this.A.ctx.evalClosure('globalThis.__lifeTpl = { get: $0, children: $1 };', [
        new ivm.Callback(tplFns.get),
        new ivm.Callback(tplFns.children),
      ]);
      await (await this.A.fn(this.A.life, 'layeredRemote')).apply(undefined, [REFS]);
    }
    this.serve = await this.A.fn(this.A.life, 'serve');
    this.revoke = await this.A.fn(this.A.life, 'revoke');
    this.epoch = await this.A.fn(this.A.life, 'epoch');
    this.check = await this.A.fn(this.A.life, 'check');
    this.capture = await this.A.fn(this.A.life, 'captureFull');
    return performance.now() - t;
  }
  get alive() {
    return !this.iso.isDisposed;
  }
  async exec({ args = ['/workspace/out.bin'], timeoutMs = 30_000, guard = true } = {}) {
    const t = { start: performance.now() };
    const sink = sinkOf(timeoutMs);
    let B;
    try {
      const epoch = this.epoch.applySync(undefined, []);
      B = await realm(this.iso, this.script, sink);
      await B.ctx.global.set('__lifeDispatch', this.serve.derefInto());
      await (await B.fn(B.life, 'install')).apply(undefined, [false, epoch]);
      t.boot = performance.now();
      const res = await runFile(B, sink, '/workspace/main.js', args, timeoutMs);
      t.run = performance.now();
      let rp = 0;
      if (this.restorePoint && 'code' in res && this.alive) {
        const c0 = performance.now();
        const [blob] = await this.capture.apply(undefined, [MAXB], { result: { copy: true } });
        rp = performance.now() - c0;
        this.rpBytes = blob.byteLength;
      }
      t.end = performance.now();
      return {
        ...res,
        ms: t.end - t.start,
        boot: t.boot - t.start,
        runMs: t.run - t.boot,
        rp,
        out: sink.out.join('').slice(0, 200),
      };
    } catch (e) {
      return { termination: classify(e), why: String(e?.message ?? e).slice(0, 120) };
    } finally {
      B?.close();
      if (this.alive) {
        if (guard) this.revoke.applySync(undefined, []);
        B?.ctx.release();
      }
    }
  }
  /** Host op = a sync call into context A (the worker side of it; IPC not included). */
  hostCall(op, args) {
    const w = this.serve.applySync(undefined, [this.epoch.applySync(undefined, []), op, args], {
      arguments: { copy: true },
      result: { copy: true },
    });
    if (w.e) throw Object.assign(new Error(w.e), { code: w.e });
    return w.r;
  }
  read(p) {
    return this.hostCall('readFileBytesSync', [p]);
  }
  heap() {
    const h = this.iso.getHeapStatisticsSync();
    return { used: h.used_heap_size, total: h.total_heap_size, ext: h.externally_allocated_size };
  }
  dispose() {
    if (this.alive) this.iso.dispose();
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const r1 = (x) => Math.round(x * 10) / 10;
const MiB = (b) => Math.round((b / 2 ** 20) * 10) / 10;
async function make(kind, src, o) {
  if (kind === 'v2' || kind === 'v2b') {
    const s = new Live(kind, src, o);
    s.createMs = await s.create();
    return s;
  }
  const t = performance.now();
  const s = new Fresh(kind, src, o);
  s.createMs = performance.now() - t;
  return s;
}
const ARMS = (process.env.ARMS ?? 'v1,v1b,v2,v2b,v3').split(',');
log({
  node: process.version,
  ivm: '7.0.2',
  platform: `${process.platform}/${process.arch}`,
  template: { files: files.length, entries: rows.length, MB: r1(pack.length / 1e6) },
  load: load(),
});

// ---- cost: first + repeated exec per workload, per arm ------------------------------------------
if (SECTIONS.has('cost')) {
  const N = Number(process.env.N ?? 7);
  for (const w of Object.keys(W)) {
    for (const kind of ARMS) {
      // warm the worker (code cache) outside the measure
      const warm = await make(kind, W[w]);
      await warm.exec();
      warm.dispose();
      const s = await make(kind, W[w]);
      const first = await s.exec();
      if (!('code' in first) || first.code !== 0) {
        log({ w, kind, failed: first });
        s.dispose();
        continue;
      }
      const reps = [];
      for (let i = 0; i < N; i++) {
        globalThis.gc?.();
        reps.push(await s.exec());
      }
      const bad = reps.find((x) => x.code !== 0);
      log({
        sec: 'cost',
        w,
        kind,
        load: load(),
        createMs: r1(s.createMs),
        firstMs: r1(first.ms),
        repMs: r1(median(reps.map((x) => x.ms))),
        repRunMs: r1(median(reps.map((x) => x.runMs))),
        repBootMs: r1(median(reps.map((x) => x.boot))),
        ...(bad ? { bad } : {}),
      });
      s.dispose();
    }
  }
}

// ---- conc: 4 sandboxes, one exec each at once (wall), after one warm exec each -----------------
if (SECTIONS.has('conc')) {
  for (const w of ['pdf', 'xlsx']) {
    for (const kind of ARMS) {
      const walls = [];
      for (let k = 0; k < 5; k++) {
        const sbs = await Promise.all([0, 1, 2, 3].map(() => make(kind, W[w])));
        for (const s of sbs) await s.exec();
        const t = performance.now();
        const rs = await Promise.all(sbs.map((s) => s.exec()));
        walls.push(performance.now() - t);
        if (rs.some((x) => x.code !== 0)) log({ w, kind, bad: rs.find((x) => x.code !== 0) });
        for (const s of sbs) s.dispose();
      }
      log({ sec: 'conc', w, kind, load: load(), wallMs: r1(median(walls)) });
    }
  }
}

// ---- mem: what one idle sandbox holds after one pdf exec (K sandboxes, gc'd) -------------------
if (SECTIONS.has('mem')) {
  const K = Number(process.env.K ?? 6);
  for (const kind of ARMS) {
    globalThis.gc();
    await new Promise((r) => setTimeout(r, 200));
    globalThis.gc();
    const m0 = process.memoryUsage();
    const sbs = [];
    for (let i = 0; i < K; i++) {
      const s = await make(kind, W.pdf);
      const r = await s.exec();
      if (r.code !== 0) log({ kind, bad: r });
      sbs.push(s);
    }
    await new Promise((r) => setTimeout(r, 300));
    globalThis.gc();
    const m1 = process.memoryUsage();
    const per = (k) => MiB((m1[k] - m0[k]) / K);
    const heaps = sbs.map((s) => (s.heap ? s.heap() : null)).filter(Boolean);
    log({
      sec: 'mem',
      kind,
      K,
      load: load(),
      perSandboxRssMiB: per('rss'),
      perSandboxNodeHeapMiB: per('heapUsed'),
      perSandboxArrayBuffersMiB: per('arrayBuffers'),
      ...(heaps.length
        ? {
            isolateUsedMiB: MiB(median(heaps.map((h) => h.used))),
            isolateTotalMiB: MiB(median(heaps.map((h) => h.total))),
            isolateExtMiB: MiB(median(heaps.map((h) => h.ext))),
          }
        : {}),
      ...(kind.startsWith('v1') ? { stateBytes: sbs[0].blob.byteLength + sbs[0].refs.length } : {}),
    });
    for (const s of sbs) s.dispose();
    sbs.length = 0;
    await new Promise((r) => setTimeout(r, 500));
    globalThis.gc();
    await new Promise((r) => setTimeout(r, 200));
    const m2 = process.memoryUsage();
    // held while alive = RSS with the K sandboxes − RSS once they are dropped (allocator retention cancels)
    log({ sec: 'mem-held', kind, K, heldPerSandboxRssMiB: MiB((m1.rss - m2.rss) / K) });
  }
}

// ---- floor: smallest passing memoryLimit (4 MiB) for create + 3 execs ---------------------------
if (SECTIONS.has('floor')) {
  for (const w of ['empty', 'pdf', 'xlsx']) {
    for (const kind of ARMS) {
      const ok = async (limit) => {
        const s = await make(kind, W[w], { limit }).catch(() => null);
        if (!s || (s.alive === false)) return false;
        let pass = true;
        for (let i = 0; i < 3 && pass; i++) pass = (await s.exec()).code === 0;
        s.dispose();
        return pass;
      };
      let lo = 8;
      let hi = 1024;
      while (hi - lo > 4) {
        const mid = Math.floor((lo + hi) / 2);
        if (await ok(mid).catch(() => false)) hi = mid;
        else lo = mid;
      }
      log({ sec: 'floor', w, kind, load: load(), floorMiB: hi });
    }
  }
}

// ---- heap: a live sandbox over N execs (v2/v2b): heap after each ------------------------------
if (SECTIONS.has('heap')) {
  const N = Number(process.env.HN ?? 40);
  for (const kind of ARMS.filter((k) => k.startsWith('v2'))) {
    for (const w of ['pdf', 'xlsx']) {
      const s = await make(kind, W[w]);
      const pts = [];
      for (let i = 0; i < N; i++) {
        const r = await s.exec();
        if (r.code !== 0) {
          log({ kind, w, i, bad: r });
          break;
        }
        // let V8 collect released contexts: an idle gap, then a heap sample
        if (i % 5 === 4 || i === 0) {
          await new Promise((res) => setTimeout(res, 50));
          const h = s.heap();
          pts.push([i + 1, MiB(h.used), MiB(h.total), r1(r.ms)]);
        }
      }
      log({ sec: 'heap', kind, w, load: load(), points: '[exec, usedMiB, totalMiB, ms]', pts });
      s.dispose();
    }
  }
}

// ---- retain: is the growth garbage or retention? N execs under a tight sandbox-life limit ------
if (SECTIONS.has('retain')) {
  const N = Number(process.env.RN ?? 60);
  for (const kind of ARMS.filter((k) => k.startsWith('v2'))) {
    for (const [w, limit] of [['pdf', Number(process.env.RL_PDF ?? 160)], ['xlsx', Number(process.env.RL_XLSX ?? 192)]]) {
      const s = await make(kind, W[w], { limit });
      const gcType = await s.A.ctx.eval('typeof gc');
      let done = 0;
      let last;
      for (let i = 0; i < N; i++) {
        last = await s.exec();
        if (last.code !== 0) break;
        done++;
      }
      const h = s.alive ? s.heap() : null;
      if (s.alive && gcType === 'function') await s.A.ctx.eval('gc()');
      const h2 = s.alive ? s.heap() : null;
      log({ sec: 'retain', kind, w, limitMiB: limit, execsOk: done, of: N, end: done < N ? last : 'all ok', usedMiB: h && MiB(h.used), usedAfterGcMiB: h2 && MiB(h2.used), gcInIsolate: gcType });
      s.dispose();
    }
  }
}

// ---- host: one host op, worker side (v2: a call into context A; v3: the worker's LayeredFs;
//      v1: the consumer's LayeredFs = probe H/W) --------------------------------------------------
if (SECTIONS.has('host')) {
  const b10 = new Uint8Array(10 * 1024).fill(7);
  for (const kind of ['v1', 'v2', 'v3']) {
    const s = await make(kind, W.pdf);
    await s.exec();
    let fs;
    if (kind === 'v1') {
      const up = createMemoryFs().fsSync;
      restoreFs(up, s.blob, OPTS);
      fs = LayeredFs.fromWire(nodeLower, up, JSON.parse(s.refs));
    }
    const op =
      kind === 'v2'
        ? (o, a) => s.hostCall(o, a)
        : (o, a) => (kind === 'v3' ? s.fs : fs)[o](...a);
    const time = (f) => {
      const xs = [];
      for (let i = 0; i < 201; i++) {
        const t = performance.now();
        f(i);
        xs.push(performance.now() - t);
      }
      return Math.round(median(xs) * 1000) / 1000;
    };
    log({
      sec: 'host',
      kind,
      load: load(),
      writeFile10KiBMs: time((i) => op('writeFileSync', [`/workspace/h${i}.bin`, b10])),
      readFilePdfMs: time(() => op('readFileBytesSync', ['/workspace/out.bin'])),
      listWorkspaceMs: time(() => op('readdirSync', ['/workspace'])),
      pdfBytes: op('readFileBytesSync', ['/workspace/out.bin']).byteLength,
    });
    s.dispose();
  }
}

// ---- life: the contract of a live isolate (v2), with v1/v3 beside where it differs -------------
if (SECTIONS.has('life')) {
  const mod = ['/workspace/mod.js', Buffer.from('module.exports = { n: 0 };')];
  // L1: what one run leaves for the next, beyond files.
  const leak = `
const fs = require('fs');
const m = require('./mod.js');
const seen = {
  global: typeof globalThis.leak, proto: [].leak, exitCode: process.exitCode ?? null, cwd: process.cwd(),
  modN: m.n, listeners: process.listenerCount('exit'), env: process.env.LEAK ?? null,
  stackLimit: Error.stackTraceLimit, json: typeof JSON.leak,
};
console.log(JSON.stringify(seen));
globalThis.leak = 1; Array.prototype.leak = 1; m.n++; process.on('exit', () => {}); process.env.LEAK = '1';
Error.stackTraceLimit = 3; JSON.leak = 1; process.chdir('/tmp');
`;
  for (const kind of ['v1', 'v2', 'v3']) {
    const s = await make(kind, leak, { extra: [mod] });
    const a = await s.exec();
    const b = await s.exec();
    log({ sec: 'life', case: 'L1 carry-over', kind, run1: a.out.trim(), run2: b.out.trim(), codes: [a.code, b.code] });
    s.dispose();
  }
  // L2: can guest code of run N reach the FS realm (v2) through what fs hands back?
  const reach = `
const fs = require('fs');
const st = fs.statSync('/workspace'); const bytes = fs.readFileSync('/workspace/main.js');
let e; try { fs.readFileSync('/nope') } catch (x) { e = x }
console.log(JSON.stringify({ statProto: Object.getPrototypeOf(st) === Object.prototype || st.constructor.name,
  bytesRealm: bytes instanceof Uint8Array, errRealm: e instanceof Error, errCode: e.code,
  lifeGlobals: Object.getOwnPropertyNames(globalThis).filter((n) => /life|probe|rifty/i.test(n)) }));
`;
  {
    const s = await make('v2', reach);
    const a = await s.exec();
    log({ sec: 'life', case: 'L2 reach FS realm', kind: 'v2', out: a.out.trim(), code: a.code });
    s.dispose();
  }
  // L3: code of a run context that runs after its run ended (a V8-internal task, not a host
  // delivery: WebAssembly.compile resolves on a posted task), with and without the epoch guard.
  const late = `
const fs = require('fs');
function leb(n){const o=[];do{let b=n&0x7f;n>>>=7;if(n)b|=0x80;o.push(b)}while(n);return o}
const body=[0x00]; for(let i=0;i<400;i++) body.push(0x41,0x01,0x1a); body.push(0x0b);
const fb=[...leb(body.length),...body], N=4000, code=[...leb(N)]; for(let i=0;i<N;i++) code.push(...fb);
const sec=(id,c)=>[id,...leb(c.length),...c];
const wasm=new Uint8Array([0,97,115,109,1,0,0,0,...sec(1,[1,0x60,0,0]),...sec(3,[...leb(N),...Array(N).fill(0)]),...sec(10,code)]);
let p = Promise.resolve();
for (let i = 0; i < CHAIN; i++) p = p.then(() => WebAssembly.compile(i ? wasm : new Uint8Array([0,97,115,109,1,0,0,0])));
p.then(() => { try { fs.writeFileSync('/workspace/late-wasm.txt', String(Date.now())); } catch (e) { globalThis.err = e.code } });
console.log(fs.existsSync('/workspace/late-wasm.txt') ? 'late-wasm.txt' : 'none');
process.exit(0);
`;
  for (const chain of [1, 30])
  for (const kind of ['v2', 'v1', 'v3']) {
    for (const guard of kind === 'v2' ? [true, false] : [true]) {
      const s = await make(kind, `const CHAIN = ${chain};${late}`);
      const a = await s.exec({ guard });
      let b;
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, Number(process.env.LATE_GAP ?? 0)));
        b = await s.exec({ guard });
      }
      const has = (f) => {
        try {
          s.read(`/workspace/${f}`);
          return true;
        } catch {
          return false;
        }
      };
      const c =
        kind === 'v2'
          ? JSON.parse(await (await s.A.fn(s.A.life, 'counters')).apply(undefined, []))
          : {};
      log({ sec: 'life', case: 'L3 work after the run ended', chain, kind, guard, run1: a.out.trim(), run4: b.out.trim(), lateWasm: has('late-wasm.txt'), staleCalls: c.stale });
      s.dispose();
    }
  }
  // L4: kills. Sync loop, microtask loop, loop in a timer callback, a pending wait (deadline).
  const KILLS = {
    syncLoop: `require('fs').writeFileSync('/workspace/before.txt', '1'); for (;;) {}`,
    microtasks: `require('fs').writeFileSync('/workspace/before.txt', '1'); (function f() { Promise.resolve().then(f) })();`,
    timerLoop: `require('fs').writeFileSync('/workspace/before.txt', '1'); setTimeout(() => { for (;;) {} }, 10);`,
    pending: `require('fs').writeFileSync('/workspace/before.txt', '1'); setTimeout(() => {}, 1e9);`,
  };
  const after = `console.log(require('fs').existsSync('/workspace/before.txt') ? 'before.txt kept' : 'before.txt absent')`;
  for (const [name, src] of Object.entries(KILLS)) {
    for (const kind of ['v1', 'v2', 'v3']) {
      const s = await make(kind, src);
      const t = performance.now();
      const k = await s.exec({ timeoutMs: 400 });
      const killMs = performance.now() - t;
      // the next exec runs a different main.js: written by a host op (v2/v3) or into the state (v1)
      if (kind === 'v2') s.hostCall('writeFileSync', ['/workspace/main.js', new TextEncoder().encode(after)]);
      else if (kind === 'v3') s.fs.writeFileSync('/workspace/main.js', new TextEncoder().encode(after));
      else {
        const up = createMemoryFs().fsSync;
        restoreFs(up, s.blob, OPTS);
        const L = LayeredFs.fromWire(nodeLower, up, JSON.parse(s.refs));
        L.writeFileSync('/workspace/main.js', new TextEncoder().encode(after));
        const wv = L.toWire();
        s.blob = snapshotFs(wv.entries, OPTS);
        s.refs = JSON.stringify(wv.refs);
      }
      const n = s.alive === false ? { termination: 'sandbox gone' } : await s.exec();
      log({ sec: 'life', case: `L4 kill ${name}`, kind, killed: k.termination ?? k.code, why: k.why, killMs: Math.round(killMs), isolateAlive: s.alive ?? 'n/a', next: n.out?.trim() ?? n.termination, nextCode: n.code });
      s.dispose();
    }
  }
  // L5: a run killed while inside FS work (v2): is the FS realm still consistent?
  const churn = `
const fs = require('fs'); fs.mkdirSync('/workspace/w', { recursive: true }); fs.mkdirSync('/workspace/v', { recursive: true });
const buf = Buffer.alloc(64 * 1024, 1);
for (let i = 0; ; i++) { const k = i % 64; fs.writeFileSync('/workspace/w/' + k, buf); fs.renameSync('/workspace/w/' + k, '/workspace/v/' + k); fs.rmSync('/workspace/v/' + ((k + 7) % 64), { force: true }); fs.cpSync('/workspace/v', '/workspace/c' + (k % 4), { recursive: true }); }
`;
  {
    const TRIALS = Number(process.env.TRIALS ?? 40);
    let bad = 0;
    const samples = [];
    const s = await make('v2', churn);
    for (let i = 0; i < TRIALS; i++) {
      const k = await s.exec({ timeoutMs: 30 + ((i * 37) % 200) });
      if (!s.alive) {
        samples.push(`trial ${i}: isolate gone (${k.termination})`);
        break;
      }
      const issues = JSON.parse(s.check.applySync(undefined, []));
      if (issues.length) {
        bad++;
        if (samples.length < 5) samples.push(`trial ${i}: ${issues.slice(0, 3).join(' | ')}`);
      }
    }
    log({ sec: 'life', case: 'L5 killed inside FS work (v2)', trials: TRIALS, inconsistent: bad, samples });
    s.dispose();
  }
  // L5b: 64 files only ever renamed between two directories: a kill must leave exactly 64.
  {
    const seed = Array.from({ length: 64 }, (_, k) => [`/workspace/w/${k}`, Buffer.alloc(4096, k)]);
    const mover = `
const fs = require('fs');
for (let i = 0; ; i++) { const k = i % 64; const a = (i >> 6) % 2 ? 'v' : 'w', b = a === 'w' ? 'v' : 'w';
  if (k === 0) fs.mkdirSync('/workspace/' + b, { recursive: true });
  fs.renameSync('/workspace/' + a + '/' + k, '/workspace/' + b + '/' + k); }
`;
    const TRIALS = Number(process.env.TRIALS ?? 200);
    let bad = 0;
    const samples = [];
    const s = await make('v2', mover, { extra: seed });
    for (let i = 0; i < TRIALS; i++) {
      await s.exec({ timeoutMs: 20 + ((i * 13) % 97) });
      let n = 0;
      for (const d of ['w', 'v']) {
        try {
          for (const e of s.hostCall('readdirSync', [`/workspace/${d}`]))
            if (s.hostCall('readFileBytesSync', [`/workspace/${d}/${e.name}`]).byteLength === 4096) n++;
        } catch {}
      }
      const issues = JSON.parse(s.check.applySync(undefined, []));
      if (n !== 64 || issues.length) {
        bad++;
        if (samples.length < 5) samples.push(`trial ${i}: ${n} files; ${issues.slice(0, 2).join(' | ')}`);
      }
    }
    log({ sec: 'life', case: 'L5b killed mid-rename (v2): 64 files must stay 64', trials: TRIALS, bad, samples });
    s.dispose();
  }
  // L6: out of isolate memory.
  const oom = `require('fs').writeFileSync('/workspace/before.txt', '1'); const a = []; for (;;) a.push('x'.repeat(1e6) + Math.random());`;
  for (const kind of ['v1', 'v2', 'v3']) {
    const s = await make(kind, oom, { limit: 256 });
    const k = await s.exec({ timeoutMs: 20_000 });
    log({ sec: 'life', case: 'L6 out of memory (limit 256)', kind, killed: k.termination ?? k.code, why: k.why, isolateAlive: s.alive ?? 'n/a', filesAfter: kind === 'v2' ? (s.alive ? 'in A' : 'lost with the isolate') : kind === 'v3' ? `before.txt ${s.fs.existsSync('/workspace/before.txt') ? 'kept' : 'absent'}` : 'state of before (rollback)' });
    s.dispose();
  }
  // L7: rebuild cost after a lost live isolate: a fresh isolate + template + the restore point.
  {
    const s = await make('v2', W.pdf, { restorePoint: true });
    const r = await s.exec();
    const t = performance.now();
    const s2 = await make('v2', W.pdf);
    const rebuild = performance.now() - t;
    log({ sec: 'life', case: 'L7 restore point', kind: 'v2', rpCaptureMs: r1(r.rp), rpBytes: s.rpBytes, rebuildMs: r1(rebuild) });
    s.dispose();
    s2.dispose();
  }
}
// ---- cata: V8's catastrophic OOM in one sandbox's run: what of the other live sandboxes? -------
if (SECTIONS.has('cata')) {
  const sbs = [];
  for (let i = 0; i < 3; i++) {
    const s = await make('v2', W.empty);
    await s.exec();
    sbs.push(s);
  }
  log({ sec: 'cata', liveSandboxes: sbs.length, note: 'next line only if the process survives' });
  const bomb = await make('v2', 'new Array(2 ** 28).fill(0)', { limit: 256 });
  const r = await bomb.exec({ timeoutMs: 20_000 });
  log({ sec: 'cata', survived: true, r });
}
process.exit(0);
