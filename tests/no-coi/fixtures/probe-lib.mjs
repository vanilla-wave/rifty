/**
 * Two-realm TextDecoder/realm-compat probe — ONE body run by the no-COI
 * substrate spec (page + `probe-worker.mjs`) and the replayable driver
 * `tools/probes/no-coi-realm-probe.mjs` (which re-runs it in Node as the
 * oracle). Exercises the REAL BUILT shims from `./dist/` — never a source
 * copy. Returns plain data (structured-clone and JSON safe).
 *
 * `mode`: 'direct' = installSharedMemoryTolerantTextDecoder() alone;
 * 'aggregate' = installWorkerRealmCompat() — sibling effects snapshot at
 * call ONE (a later call must not be what makes them observable). Direct mode
 * additionally runs the realm's FIRST aggregate call AFTER the helper install
 * (parity 14 mixed sequence — sibling installers must still run).
 */

const HELLO = [104, 101, 108, 108, 111]; // 'hello'

/** Run `fn` (sync or async), record outcome as plain data (never throw out of a check). */
async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return {
      ok: false,
      errName: err instanceof Error ? err.name : 'unknown',
      errMsg: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Shared-wasm memory (the no-COI shared BufferSource — probe row 2). */
function makeSharedWasmMemory() {
  return new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
}

/** Write 'hello' at byte offset 3 with 0xFF sentinels on both sides. */
function writeHelloWithSentinels(buffer) {
  const all = new Uint8Array(buffer);
  all[1] = 0xff;
  all[2] = 0xff;
  all.set(HELLO, 3);
  all[8] = 0xff;
  all[9] = 0xff;
}

/** EXACT whole-buffer record: length + SHA-256 hex of the UTF-8 text.
 * 65536 chars is not portable output; a digest is exact where projections
 * (char counts, slices) collide on corrupted/repositioned sentinels. */
async function exactTextRecord(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return {
    length: text.length,
    sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

/** `self` observed WITHOUT writing it: pre-write value + ownership + descriptor.
 * Kills the lossy check where an assignment-then-compare passes on `self=null`
 * or an inherited setter. */
function selfSnapshot() {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'self');
  return {
    isGlobalThis: globalThis.self === globalThis,
    hasOwn: Object.hasOwn(globalThis, 'self'),
    ownWritableData: desc !== undefined && 'value' in desc && desc.writable === true,
  };
}

/** Streaming: 'é' (0xC3,0xA9) split across two shared-backed views, ONE decoder.
 * Own memory so the raw-buffer row's bytes stay exactly sentinels+hello. */
function streamingParts(Dec) {
  const buffer = makeSharedWasmMemory().buffer;
  const bytes = new Uint8Array(buffer);
  bytes[100] = 0xc3;
  bytes[101] = 0xa9;
  const dec = new Dec();
  const first = dec.decode(new Uint8Array(buffer, 100, 1), { stream: true });
  const final = dec.decode(new Uint8Array(buffer, 101, 1));
  return [first, final];
}

/**
 * Parity 12 — binding-access poison (frozen-assumption killer): output
 * assertions alone cannot reject a try/catch implementation that still
 * EVALUATES the bare `SharedArrayBuffer` identifier. Define the global as a
 * counting, throwing accessor for the duration of a full patched-decode sweep;
 * the contract's "decode NEVER evaluates the absent binding" means count === 0
 * with every output intact. Prior binding state restored exactly.
 */
async function poisonedBindingSweep(mem) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'SharedArrayBuffer');
  let count = 0;
  Object.defineProperty(globalThis, 'SharedArrayBuffer', {
    configurable: true,
    get() {
      count += 1;
      throw new Error('POISON: bare SharedArrayBuffer binding evaluated');
    },
  });
  try {
    const enc = new TextEncoder();
    const sweep = {
      bytes: await attempt(() => new TextDecoder().decode(enc.encode('hello'))),
      noArg: await attempt(() => new TextDecoder().decode()),
      sharedView: await attempt(() => new TextDecoder().decode(new Uint8Array(mem.buffer, 3, 5))),
      sharedDataView: await attempt(() => new TextDecoder().decode(new DataView(mem.buffer, 3, 5))),
      rawShared: await attempt(() => exactTextRecord(new TextDecoder().decode(mem.buffer))),
      streaming: await attempt(() => streamingParts(TextDecoder)),
    };
    return { count, sweep };
  } finally {
    if (prior === undefined) {
      Reflect.deleteProperty(globalThis, 'SharedArrayBuffer');
    } else {
      Object.defineProperty(globalThis, 'SharedArrayBuffer', prior);
    }
  }
}

/** Parity 9 identity pins via an injected spy decoder: exact-object capture AND
 * unique-sentinel RETURN pass-through (a wrapper that hands the original the
 * exact objects then fabricates its own output must fail — `lossy-aggregate`). */
async function identityChecks(installShim) {
  const seen = [];
  class SpyDecoder {
    decode(...args) {
      seen.push({ input: args[0], opts: args[1], argc: args.length });
      return `spy-${seen.length}`;
    }
  }
  installShim(SpyDecoder);
  const d = new SpyDecoder();
  const view = new Uint8Array([1, 2, 3]);
  const dv = new DataView(new ArrayBuffer(4));
  const ab = new ArrayBuffer(2);
  const opts = { stream: true };
  const out = {};
  const identityRow = (call, expectInput, expectOpts) =>
    attempt(() => {
      const ret = call();
      const s = seen[seen.length - 1];
      return s.input === expectInput && s.opts === expectOpts && ret === `spy-${seen.length}`;
    });
  out.view = await identityRow(() => d.decode(view, opts), view, opts);
  out.dataView = await identityRow(() => d.decode(dv, opts), dv, opts);
  out.arrayBuffer = await identityRow(() => d.decode(ab, opts), ab, opts);
  out.noArg = await identityRow(() => d.decode(), undefined, undefined);
  // Error-object identity: a sentinel thrown by the spy propagates as-is.
  const sentinelErr = new Error('sentinel');
  class ThrowingDecoder {
    decode() {
      throw sentinelErr;
    }
  }
  installShim(ThrowingDecoder);
  out.errorIdentity = await attempt(() => {
    try {
      new ThrowingDecoder().decode(new Uint8Array(1));
      return 'no-throw';
    } catch (err) {
      return err === sentinelErr;
    }
  });
  // Shared-wasm input, FIRST error identity + throw count: a fresh error per
  // call exposes a try-native/catch/copy-retry wrapper (it propagates the
  // SECOND thrown object with count 2) where a single reused sentinel passes.
  const thrown = [];
  class FreshThrowingDecoder {
    decode() {
      const err = new Error(`fresh-sentinel-${thrown.length}`);
      thrown.push(err);
      throw err;
    }
  }
  installShim(FreshThrowingDecoder);
  out.errorIdentitySharedFirst = await attempt(() => {
    const sharedView = new Uint8Array(makeSharedWasmMemory().buffer, 0, 4);
    try {
      new FreshThrowingDecoder().decode(sharedView);
      return 'no-throw';
    } catch (err) {
      return { first: thrown.length > 0 && err === thrown[0], throwCount: thrown.length };
    }
  });
  return out;
}

/**
 * @param {'direct'|'aggregate'} mode
 * @param {{requireNoCoi?: boolean, nativeUtilTypes?: object}} [opts]
 *   Node oracle runs pass `requireNoCoi: false` and the REAL `node:util/types`
 *   namespace as `nativeUtilTypes` (differential for the built util-types —
 *   without it the "Node oracle" would just re-run rifty code in Node).
 */
export async function runProbe(mode, { requireNoCoi = true, nativeUtilTypes } = {}) {
  const r = { mode };

  // Reference-contract preconditions — asserted BEFORE acting so a future
  // Chromium change fails loud instead of silently re-scoping the lane.
  r.crossOriginIsolated = globalThis.crossOriginIsolated;
  r.sabBindingTypeof = typeof SharedArrayBuffer;
  if (requireNoCoi && (r.crossOriginIsolated !== false || r.sabBindingTypeof !== 'undefined')) {
    throw new Error(
      `no-COI substrate precondition violated: crossOriginIsolated=${String(
        r.crossOriginIsolated,
      )}, typeof SharedArrayBuffer=${r.sabBindingTypeof}`,
    );
  }

  const mem = makeSharedWasmMemory();
  r.wasmSharedBrand = Object.prototype.toString.call(mem.buffer);
  r.wasmSharedInstanceofArrayBuffer = mem.buffer instanceof ArrayBuffer;
  writeHelloWithSentinels(mem.buffer);

  // Import BOTH built modules BEFORE installing: in a binding-less realm the
  // patched decode poisons module loading itself where the host loader consumes
  // the realm TextDecoder (observed: Node ESM loader crashes on the next
  // dynamic import after install — the 'EVERY decode' blast radius is real).
  const shim = await import('./dist/worker-realm-compat.mjs');
  const utilTypes = await import('./dist/util-types.mjs');

  // NATIVE rows (pre-install): the realm's own TextDecoder against shared input.
  const enc = new TextEncoder();
  r.native = {
    bytes: await attempt(() => new TextDecoder().decode(enc.encode('hello'))),
    noArg: await attempt(() => new TextDecoder().decode()),
    sharedView: await attempt(() => new TextDecoder().decode(new Uint8Array(mem.buffer, 3, 5))),
    sharedDataView: await attempt(() => new TextDecoder().decode(new DataView(mem.buffer, 3, 5))),
    rawShared: await attempt(() => exactTextRecord(new TextDecoder().decode(mem.buffer))),
    streaming: await attempt(() => streamingParts(TextDecoder)),
  };

  // INSTALL (real built shim).
  const markerOf = () => TextDecoder.prototype.decode.__riftyShared === true;
  if (mode === 'aggregate') {
    shim.installWorkerRealmCompat();
    r.firstInstall = markerOf();
    // Sibling effects snapshot IMMEDIATELY after call ONE — before any repeat
    // call or decode sweep, so a call-one decoder-only guard cannot pass.
    // Order per contract: pre-write self value + ownership + descriptor, THEN
    // the assignment, then a decode.
    r.afterFirstInstall = {
      marker: markerOf(),
      globalAlias: globalThis.global === globalThis,
      self: selfSnapshot(),
      selfAssign: await attempt(() => {
        globalThis.self = globalThis;
        return globalThis.self === globalThis;
      }),
      decodeBytes: await attempt(() => new TextDecoder().decode(enc.encode('hello'))),
    };
  } else {
    r.firstInstall = shim.installSharedMemoryTolerantTextDecoder();
  }
  r.marker = markerOf();
  const captured = TextDecoder.prototype.decode;

  // Repeat install (parity 7): boolean AND captured-function identity.
  if (mode === 'aggregate') shim.installWorkerRealmCompat();
  r.repeatDirectReturned = shim.installSharedMemoryTolerantTextDecoder();
  r.repeatIdentity = TextDecoder.prototype.decode === captured;

  // Parity 14 (observable-order): in direct mode the realm decoder is ALREADY
  // marked when the FIRST installWorkerRealmCompat() arrives — an aggregate
  // early return keyed on that marker would skip global/self here while every
  // clean aggregate combo (fresh realm) still passes. Snapshot immediately.
  if (mode === 'direct') {
    shim.installWorkerRealmCompat();
    r.mixedDirectThenAggregate = {
      decoderIdentity: TextDecoder.prototype.decode === captured,
      marker: markerOf(),
      globalAlias: globalThis.global === globalThis,
      self: selfSnapshot(),
      decodeBytes: await attempt(() => new TextDecoder().decode(enc.encode('hello'))),
    };
  }

  r.patched = {
    bytes: await attempt(() => new TextDecoder().decode(enc.encode('hello'))),
    noArg: await attempt(() => new TextDecoder().decode()),
    sharedView: await attempt(() => new TextDecoder().decode(new Uint8Array(mem.buffer, 3, 5))),
    sharedDataView: await attempt(() => new TextDecoder().decode(new DataView(mem.buffer, 3, 5))),
    rawShared: await attempt(() => exactTextRecord(new TextDecoder().decode(mem.buffer))),
    streaming: await attempt(() => streamingParts(TextDecoder)),
    // Parity 15: non-shared sibling classes through the REALM decoder — actual
    // Node outputs, both install modes (the injected-spy sweep is direct-only).
    privDataView: await attempt(() =>
      new TextDecoder().decode(new DataView(enc.encode('hello').buffer)),
    ),
    privArrayBuffer: await attempt(() => new TextDecoder().decode(enc.encode('hello').buffer)),
  };

  // Parity 12: poisoned-binding sweep on the patched realm decoder — decode
  // must never evaluate the bare binding (count 0) while outputs stay intact.
  r.poisonedBinding = await poisonedBindingSweep(mem);

  // Built util-types (parity 10) — brand-based, must match Node with no throw.
  const utilTypesChecks = (m) => ({
    privateIsShared: m.isSharedArrayBuffer(new ArrayBuffer(1)),
    privateIsAny: m.isAnyArrayBuffer(new ArrayBuffer(1)),
    sharedWasmIsShared: m.isSharedArrayBuffer(mem.buffer),
    sharedWasmIsAny: m.isAnyArrayBuffer(mem.buffer),
  });
  r.utilTypes = await attempt(() => utilTypesChecks(utilTypes));
  if (nativeUtilTypes !== undefined) {
    // Same predicates, same inputs, REAL node:util/types — the differential row.
    r.utilTypesNative = await attempt(() => utilTypesChecks(nativeUtilTypes));
  }

  // Parity 8–9 evidence (injected decoders; COI-unit pins live in vitest —
  // recorded here so the Node oracle rows are replayable and the realm rows
  // flip green with the fix).
  r.identity = await identityChecks(shim.installSharedMemoryTolerantTextDecoder);

  return r;
}
