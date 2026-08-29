/**
 * Two-realm TextDecoder/realm-compat probe — the ONE probe body run by:
 *   - the no-COI substrate spec (page realm via import, Worker realm via
 *     `probe-worker.mjs`) — RED targets for
 *     `docs/backlog/runtime-js/worker-realm-compat-bare-sab-referenceerror.md`;
 *   - `tools/probes/no-coi-realm-probe.mjs` — replayable evidence driver for
 *     `docs/backlog/runtime-js/reference/no-coi-degradation-probes.md`
 *     (same body re-run in Node v24 as the oracle, with and without the
 *     `SharedArrayBuffer` binding).
 *
 * Exercises the REAL BUILT shim (`./dist/worker-realm-compat.mjs`, esbuild of
 * `packages/runtime-js/src/ipc/worker-realm-compat.ts` — never a source copy)
 * plus built `util-types`. Returns plain-data results only (structured-clone
 * and JSON safe).
 *
 * `mode`: 'direct' installs `installSharedMemoryTolerantTextDecoder()` alone;
 * 'aggregate' installs via `installWorkerRealmCompat()` (global alias +
 * writable self + decoder patch — sibling effects pinned together).
 */

const HELLO = [104, 101, 108, 108, 111]; // 'hello'

/** Run `fn`, record outcome as plain data (never throw out of a check). */
function attempt(fn) {
  try {
    return { ok: true, value: fn() };
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

/** Derived record of a whole-shared-buffer decode (65536 chars is not portable output). */
function describeWholeBufferText(text, offset, expected) {
  let nonNul = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 0 && (i < offset || i >= offset + expected.length)) nonNul++;
  }
  return { length: text.length, atOffset: text.slice(offset, offset + expected.length), nonNul };
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
function identityChecks(installShim) {
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
  out.view = attempt(() => {
    d.decode(view, opts);
    const s = seen.pop();
    return s.input === view && s.opts === opts;
  });
  out.dataView = attempt(() => {
    d.decode(dv, opts);
    const s = seen.pop();
    return s.input === dv && s.opts === opts;
  });
  out.arrayBuffer = attempt(() => {
    d.decode(ab, opts);
    const s = seen.pop();
    return s.input === ab && s.opts === opts;
  });
  out.noArg = attempt(() => {
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
  out.errorIdentity = attempt(() => {
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
 * @param {{requireNoCoi?: boolean}} [opts] Node oracle runs pass `false`.
 */
export async function runProbe(mode, { requireNoCoi = true } = {}) {
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
    bytes: attempt(() => new TextDecoder().decode(enc.encode('hello'))),
    noArg: attempt(() => new TextDecoder().decode()),
    sharedView: attempt(() => new TextDecoder().decode(new Uint8Array(mem.buffer, 3, 5))),
    rawShared: attempt(() =>
      describeWholeBufferText(new TextDecoder().decode(mem.buffer), 3, 'hello'),
    ),
    streaming: attempt(() => streamingParts(TextDecoder)),
  };

  // INSTALL (real built shim), then the patched sweep.
  const markerOf = () => TextDecoder.prototype.decode.__riftyShared === true;
  if (mode === 'aggregate') {
    shim.installWorkerRealmCompat();
    r.firstInstall = markerOf();
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
    bytes: attempt(() => new TextDecoder().decode(enc.encode('hello'))),
    noArg: attempt(() => new TextDecoder().decode()),
    sharedView: attempt(() => new TextDecoder().decode(new Uint8Array(mem.buffer, 3, 5))),
    sharedDataView: attempt(() => new TextDecoder().decode(new DataView(mem.buffer, 3, 5))),
    rawShared: attempt(() =>
      describeWholeBufferText(new TextDecoder().decode(mem.buffer), 3, 'hello'),
    ),
    streaming: attempt(() => streamingParts(TextDecoder)),
  };

  // Aggregate sibling effects (parity 6) — recorded in every mode; asserted
  // for aggregate runs (no guard may skip a sibling installer).
  r.globalAlias = globalThis.global === globalThis;
  r.selfWritable = attempt(() => {
    globalThis.self = globalThis;
    return globalThis.self === globalThis;
  });

  // Built util-types (parity 10) — brand-based, must match Node with no throw.
  r.utilTypes = attempt(() => ({
    privateIsShared: utilTypes.isSharedArrayBuffer(new ArrayBuffer(1)),
    privateIsAny: utilTypes.isAnyArrayBuffer(new ArrayBuffer(1)),
    sharedWasmIsShared: utilTypes.isSharedArrayBuffer(mem.buffer),
    sharedWasmIsAny: utilTypes.isAnyArrayBuffer(mem.buffer),
  }));

  // Parity 8–9 evidence (injected decoders; COI-unit pins live in vitest —
  // recorded here so the Node oracle rows are replayable and the realm rows
  // flip green with the fix).
  r.identity = identityChecks(shim.installSharedMemoryTolerantTextDecoder);

  return r;
}
