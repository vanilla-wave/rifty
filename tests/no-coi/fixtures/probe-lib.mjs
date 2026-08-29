/**
 * Two-realm TextDecoder/realm-compat probe — ONE body run by the no-COI
 * substrate spec (page + `probe-worker.mjs`) and the replayable driver
 * `tools/probes/no-coi-realm-probe.mjs` (which re-runs it in Node as the
 * oracle). Exercises the REAL BUILT shims from `./dist/` — never a source
 * copy. Returns plain data (structured-clone and JSON safe).
 *
 * `mode`: 'direct' = installSharedMemoryTolerantTextDecoder() alone;
 * 'aggregate' = installWorkerRealmCompat() — sibling effects snapshot at
 * call ONE (a later call must not be what makes them observable).
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

/** Parity 9 identity pins via an injected spy decoder (exact-object capture). */
async function identityChecks(installShim) {
  const seen = [];
  class SpyDecoder {
    decode(...args) {
      seen.push({ input: args[0], opts: args[1], argc: args.length });
      return 'spy';
    }
  }
  installShim(SpyDecoder);
  const d = new SpyDecoder();
  const view = new Uint8Array([1, 2, 3]);
  const dv = new DataView(new ArrayBuffer(4));
  const ab = new ArrayBuffer(2);
  const opts = { stream: true };
  const out = {};
  out.view = await attempt(() => {
    d.decode(view, opts);
    const s = seen.pop();
    return s.input === view && s.opts === opts;
  });
  out.dataView = await attempt(() => {
    d.decode(dv, opts);
    const s = seen.pop();
    return s.input === dv && s.opts === opts;
  });
  out.arrayBuffer = await attempt(() => {
    d.decode(ab, opts);
    const s = seen.pop();
    return s.input === ab && s.opts === opts;
  });
  out.noArg = await attempt(() => {
    d.decode();
    const s = seen.pop();
    return s.input === undefined && s.opts === undefined;
  });
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

  r.patched = {
    bytes: await attempt(() => new TextDecoder().decode(enc.encode('hello'))),
    noArg: await attempt(() => new TextDecoder().decode()),
    sharedView: await attempt(() => new TextDecoder().decode(new Uint8Array(mem.buffer, 3, 5))),
    sharedDataView: await attempt(() => new TextDecoder().decode(new DataView(mem.buffer, 3, 5))),
    rawShared: await attempt(() => exactTextRecord(new TextDecoder().decode(mem.buffer))),
    streaming: await attempt(() => streamingParts(TextDecoder)),
  };

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
