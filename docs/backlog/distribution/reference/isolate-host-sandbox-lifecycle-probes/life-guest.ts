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

/** v1w: the template's index built ahead (a pre-warmed isolate), the sandbox's state later. */
let lifePrepLower: unknown;
function prepTemplate(pack: Uint8Array, index: string): void {
  lifePrepLower = templateLayer(pack, JSON.parse(index));
}
function layeredPrepared(refs: string): void {
  const L = LifeLayeredFs.fromWire(
    lifePrepLower as never,
    lifeSyncMirror() as never,
    JSON.parse(refs),
  );
  (globalThis as unknown as Record<string, unknown>).__lifeLayered = L;
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

// ---- safe boundary (arms v2s / v2bs): only primitives and fresh typed arrays cross -------------
// Captured at bundle evaluation, before any guest code in this realm (A never runs guest code; a
// run realm B evaluates the bundle before `installSafe`). A object never reaches B's code that the
// guest can hook, and A never looks up a property of a B object: B → A carries a JSON string, a
// method name and at most one typed array B made itself (read by A only through internal slots,
// `%TypedArray%.prototype.set`); A → B carries a JSON string, bytes copied by A into a typed array
// B made (`takeBytes`, again `set` with B's array as `this`). Errors cross as JSON.
const lifeP = {
  stringify: JSON.stringify,
  parse: JSON.parse,
  isView: ArrayBuffer.isView,
  U8: Uint8Array,
  set: Uint8Array.prototype.set,
  apply: Reflect.apply,
  isArray: Array.isArray,
  keys: Object.keys,
};
let lifePending: Uint8Array | null = null;
const lifeSafeCounters = { calls: 0, stale: 0, refused: 0 };
/** A: one call. `json` is B's JSON of the arguments, `bytes` (or null) replaces the argument `{"__b":1}`. */
function serveSafe(epoch: unknown, op: unknown, json: unknown, n: unknown, bytes: unknown): string {
  try {
    if (
      typeof epoch !== 'number' ||
      typeof op !== 'string' ||
      typeof json !== 'string' ||
      typeof n !== 'number'
    )
      return '{"e":"EINVAL","p":""}';
    if (epoch !== lifeEpoch) {
      lifeSafeCounters.stale++;
      return '{"e":"EBADF","p":"","m":"stale run context"}';
    }
    if (!(LIFE_METHODS as readonly string[]).includes(op)) return '{"e":"ENOSYS","p":""}';
    lifeSafeCounters.calls++;
    const args = lifeP.parse(json) as unknown[];
    if (!lifeP.isArray(args)) return '{"e":"EINVAL","p":""}';
    for (let i = 0; i < args.length; i++) {
      const a = args[i] as { __b?: unknown } | null;
      if (a !== null && typeof a === 'object' && a.__b === 1) {
        // Internal slots only: isView and set read no property of B's array.
        if (!lifeP.isView(bytes)) {
          lifeSafeCounters.refused++;
          return '{"e":"EINVAL","p":""}';
        }
        const copy = new lifeP.U8(n);
        lifeP.apply(lifeP.set, copy, [bytes]);
        args[i] = copy;
      }
    }
    const fs = lifeSyncMirror() as unknown as Record<string, (...a: unknown[]) => unknown>;
    const r = fs[op](...args);
    if (lifeP.isView(r)) {
      lifePending = r as Uint8Array;
      return lifeP.stringify({ b: (r as Uint8Array).byteLength });
    }
    return lifeP.stringify({ r: r === undefined ? null : r });
  } catch (e) {
    try {
      const err = e as { code?: unknown; path?: unknown; message?: unknown };
      return lifeP.stringify({
        e: typeof err?.code === 'string' ? err.code : 'EIO',
        p: typeof err?.path === 'string' ? err.path : '',
        m: typeof err?.message === 'string' ? err.message : '',
      });
    } catch {
      return '{"e":"EIO","p":""}';
    }
  }
}
/** A: copy the pending result bytes into B's fresh array (`set` with B's array as `this`). */
function takeBytes(dst: unknown): number {
  const src = lifePending;
  lifePending = null;
  if (src === null || !lifeP.isView(dst)) return 0;
  try {
    lifeP.apply(lifeP.set, dst, [src]);
    return 1;
  } catch {
    return 0;
  }
}
/** B: the realm's FsSync over A's `serveSafe` / `takeBytes`, using only intrinsics captured above. */
function installSafe(epoch: number): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const serveA = g.__lifeDispatch as (
    e: number,
    op: string,
    j: string,
    n: number,
    b: unknown,
  ) => string;
  const takeA = g.__lifeTake as (dst: Uint8Array) => number;
  // biome-ignore lint/performance/noDelete: probe
  delete g.__lifeDispatch;
  // biome-ignore lint/performance/noDelete: probe
  delete g.__lifeTake;
  const P = lifeP;
  const fs: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of LIFE_METHODS)
    fs[m] = (...args: unknown[]) => {
      let bytes: Uint8Array | null = null;
      let n = 0;
      const plain: unknown[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (P.isView(a)) {
          const v = a as ArrayBufferView;
          n = v.byteLength;
          bytes = new P.U8(n);
          P.apply(P.set, bytes, [new P.U8(v.buffer, v.byteOffset, n)]);
          plain[i] = { __b: 1 };
        } else plain[i] = a;
      }
      let j: unknown;
      try {
        j = serveA(epoch, m, P.stringify(plain), n, bytes);
      } catch {
        // An A error object (e.g. its stack overflowed) is dropped unread.
        j = undefined;
      }
      if (typeof j !== 'string') throw new LifeVfsError('EIO' as never, '', 'fs realm call failed');
      const w = P.parse(j) as { r?: unknown; b?: number; e?: string; p?: string; m?: string };
      if (typeof w.e === 'string')
        throw new LifeVfsError(w.e as never, String(w.p ?? ''), w.m || undefined);
      if (typeof w.b === 'number') {
        const out = new P.U8(w.b);
        if (takeA(out) !== 1) throw new LifeVfsError('EIO' as never, '', 'fs realm bytes lost');
        return out;
      }
      return w.r;
    };
  lifeSetSyncMirror(fs as never);
}
/**
 * Host-side oracle (review of PR #454): every own property of this realm's intrinsics — string and
 * symbol keys, the full descriptor (value by identity, get / set by identity, writable, enumerable,
 * configurable) — plus each root's prototype and extensibility, captured at bundle evaluation
 * (before anything else runs in this realm). `fingerprint()` returns what differs now.
 */
const lifeRoots = (() => {
  const TA = Object.getPrototypeOf(Uint8Array);
  const ctors = [
    Object,
    Array,
    Function,
    TA,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Error,
    TypeError,
    RangeError,
    String,
    Number,
    Boolean,
    Symbol,
    Promise,
    RegExp,
    Date,
    BigInt,
  ];
  const roots: [string, object][] = [
    ['globalThis', globalThis],
    ['JSON', JSON],
    ['Reflect', Reflect],
    ['Math', Math],
  ];
  for (const C of ctors) {
    roots.push([C.name || 'TypedArray', C]);
    roots.push([`${C.name || 'TypedArray'}.prototype`, C.prototype as object]);
  }
  return roots;
})();
type LifeSnap = Map<PropertyKey, PropertyDescriptor>;
const lifeSnap = (o: object): { proto: object | null; ext: boolean; props: LifeSnap } => {
  const props: LifeSnap = new Map();
  for (const k of Reflect.ownKeys(o))
    props.set(k, Reflect.getOwnPropertyDescriptor(o, k) as PropertyDescriptor);
  return { proto: Reflect.getPrototypeOf(o), ext: Reflect.isExtensible(o), props };
};
const lifeBaseline = lifeRoots.map(([n, o]) => [n, o, lifeSnap(o)] as const);
function fingerprint(): string {
  const diffs: string[] = [];
  const same = (a: PropertyDescriptor, b: PropertyDescriptor): boolean =>
    Object.is(a.value, b.value) &&
    a.get === b.get &&
    a.set === b.set &&
    a.writable === b.writable &&
    a.enumerable === b.enumerable &&
    a.configurable === b.configurable;
  for (const [name, o, before] of lifeBaseline) {
    const now = lifeSnap(o);
    if (now.proto !== before.proto) diffs.push(`${name}: prototype`);
    if (now.ext !== before.ext) diffs.push(`${name}: extensible`);
    for (const [k, d] of now.props) {
      const was = before.props.get(k);
      // globalThis: the probe's own late globals (__life, __probe, __lifeLayered…) are not intrinsics
      if (name === 'globalThis' && was === undefined && typeof k === 'string' && k.startsWith('__'))
        continue;
      if (was === undefined) diffs.push(`${name}.${String(k)}: added`);
      else if (!same(was, d)) diffs.push(`${name}.${String(k)}: changed`);
    }
    for (const k of before.props.keys())
      if (!now.props.has(k)) diffs.push(`${name}.${String(k)}: removed`);
  }
  return JSON.stringify(diffs);
}

Object.defineProperty(globalThis, '__life', {
  value: Object.freeze({
    serve,
    install,
    serveSafe,
    takeBytes,
    installSafe,
    fingerprint,
    safeCounters: () => JSON.stringify(lifeSafeCounters),
    layeredRemote,
    prepTemplate,
    layeredPrepared,
    captureFull,
    check,
    revoke: () => {
      lifePending = null;
      return ++lifeEpoch;
    },
    epoch: () => lifeEpoch,
    counters: () => JSON.stringify(lifeCounters),
  }),
  configurable: true,
});
