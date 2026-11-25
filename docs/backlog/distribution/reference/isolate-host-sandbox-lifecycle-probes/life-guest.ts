/**
 * Probe-only guest additions (NOT a design), appended by `life.mjs` after the template probes'
 * `probe-guest.ts` (itself after the real guest entry). One FsSync surface installed from outside
 * the realm, so the same guest bundle serves three lifecycles:
 *
 * - FS realm (variant 2, context A of a live isolate): `serve(op, args)` dispatches to this realm's
 *   FS (a `LayeredFs` once `__probe.layered*` ran); args deep-copied INTO this realm, a result
 *   returned raw (the client copies it out). `epoch` guards a released run context (`revoke`).
 * - Run realm (every variant): `install(raw)` makes `globalThis.__lifeDispatch` (A's `serve` or a
 *   host `ivm.Callback`) the realm's only FS surface; with `raw` false every result is copied into
 *   this realm, so no object of the FS realm reaches guest code.
 * - Lazy template (variants 1b/2b): `layeredRemote(refs)` builds the `Lower` over 2 host functions
 *   (`__lifeTpl.get/children`), cached in this realm for its life.
 */
import { VfsError as LifeVfsError, syncMirror as lifeSyncMirror } from '@riftydev/vfs';
import { setSyncMirror as lifeSetSyncMirror } from '@riftydev/vfs/internal';
import { LayeredFs as LifeLayeredFs } from '__LAYERED__';

const LIFE_METHODS = [
  'existsSync',
  'readFileBytesSync',
  'writeFileSync',
  'readdirSync',
  'mkdirSync',
  'rmSync',
  'statSync',
  'statSyncOrNull',
  'utimes',
  'copyFileSync',
  'cpSync',
  'renameSync',
] as const;
type Wire = { r?: unknown; e?: string; path?: string; message?: string };

/** Deep copy of plain data into THIS realm (bytes → an exact Uint8Array of the view's range). */
function lifeCopy(x: unknown): unknown {
  if (x === null || typeof x !== 'object') return typeof x === 'function' ? undefined : x;
  if (ArrayBuffer.isView(x)) {
    const v = x as ArrayBufferView;
    return new Uint8Array(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  }
  if (Array.isArray(x)) return x.map(lifeCopy);
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(x)) o[k] = lifeCopy((x as Record<string, unknown>)[k]);
  return o;
}

// ---- FS realm --------------------------------------------------------------------------------
let lifeEpoch = 0;
const lifeCounters = { calls: 0, stale: 0 };
function serve(epoch: number, op: string, args: unknown[]): Wire {
  if (epoch !== lifeEpoch) {
    lifeCounters.stale++;
    return { e: 'EBADF', path: '', message: 'stale run context' };
  }
  lifeCounters.calls++;
  if (!(LIFE_METHODS as readonly string[]).includes(op)) return { e: 'ENOSYS', path: '' };
  const fs = lifeSyncMirror() as unknown as Record<string, (...a: unknown[]) => unknown>;
  try {
    return { r: fs[op](...(lifeCopy(args) as unknown[])) };
  } catch (e) {
    const err = e as { code?: unknown; path?: unknown; message?: unknown };
    return {
      e: typeof err?.code === 'string' ? err.code : 'EIO',
      path: typeof err?.path === 'string' ? err.path : '',
      message: typeof err?.message === 'string' ? err.message : '',
    };
  }
}

// ---- run realm -------------------------------------------------------------------------------
function install(raw: boolean, epoch: number): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const dispatch = g.__lifeDispatch as (epoch: number, op: string, args: unknown[]) => Wire;
  // biome-ignore lint/performance/noDelete: probe
  delete g.__lifeDispatch;
  const fs: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of LIFE_METHODS)
    fs[m] = (...args: unknown[]) => {
      const w = dispatch(epoch, m, args);
      const e = w.e;
      if (typeof e === 'string')
        throw new LifeVfsError(e as never, String(w.path ?? ''), w.message || undefined);
      return raw ? w.r : lifeCopy(w.r);
    };
  lifeSetSyncMirror(fs as never);
}

// ---- lazy template (a Lower over host functions, cached for the realm's life) ----------------
type HostTpl = {
  get(p: string): readonly [number, Uint8Array | null, number, number, number, number] | null;
  children(p: string): readonly string[];
};
function layeredRemote(refs: string): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const host = g.__lifeTpl as HostTpl;
  const entries = new Map<string, unknown>();
  const kids = new Map<string, readonly string[]>();
  const lower = {
    get(p: string) {
      if (entries.has(p)) return entries.get(p);
      const r = host.get(p);
      const e =
        r === null
          ? undefined
          : {
              dir: r[0] === 1,
              ...(r[0] === 1 ? {} : { bytes: r[1] as Uint8Array }),
              mtimeMs: r[2],
              atimeMs: r[3],
              ctimeMs: r[4],
              birthtimeMs: r[5],
            };
      entries.set(p, e);
      return e;
    },
    children(p: string) {
      let c = kids.get(p);
      if (c === undefined) {
        c = host.children(p);
        kids.set(p, c);
      }
      return c;
    },
  };
  // The realm's FS (restored own files) becomes the upper, as probe-guest's `layered`.
  const L = LifeLayeredFs.fromWire(lower as never, lifeSyncMirror() as never, JSON.parse(refs));
  (g as { __lifeLayered?: unknown }).__lifeLayered = L;
  lifeSetSyncMirror(L as never);
}

/** The state of this realm's LayeredFs as the wire (own entries blob + reference rows). */
function captureFull(maxBytes: number): [Uint8Array, string] {
  const g = globalThis as unknown as Record<string, unknown>;
  const L = (g.__lifeLayered ?? lifeSyncMirror()) as LifeLayeredFs;
  const w = L.toWire();
  return [snapshotFs(w.entries as never, { template: null, maxBytes }), JSON.stringify(w.refs)];
}
/** Structural self-check of the FS realm after a killed run: LayeredFs audit + a full walk. */
function check(): string {
  const g = globalThis as unknown as Record<string, unknown>;
  const L = (g.__lifeLayered ?? lifeSyncMirror()) as LifeLayeredFs & { audit?: () => string[] };
  const bad: string[] = [];
  try {
    bad.push(...(L.audit?.() ?? []));
    const walk = (d: string): void => {
      for (const e of L.readdirSync(d)) {
        const p = `${d === '/' ? '' : d}/${e.name}`;
        const st = L.statSync(p);
        if (st.isDirectory !== e.isDirectory) bad.push(`kind ${p}`);
        if (e.isDirectory) walk(p);
        else if (L.readFileBytesSync(p).byteLength !== st.size) bad.push(`size ${p}`);
      }
    };
    walk('/workspace');
  } catch (e) {
    bad.push(`throw ${String((e as Error)?.message ?? e)}`);
  }
  return JSON.stringify(bad);
}

Object.defineProperty(globalThis, '__life', {
  value: Object.freeze({
    serve,
    install,
    layeredRemote,
    captureFull,
    check,
    revoke: () => ++lifeEpoch,
    epoch: () => lifeEpoch,
    counters: () => JSON.stringify(lifeCounters),
  }),
  configurable: true,
});
