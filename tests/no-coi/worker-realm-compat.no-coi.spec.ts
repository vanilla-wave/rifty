/**
 * RED-first no-COI substrate — contract
 * `docs/backlog/runtime-js/worker-realm-compat-bare-sab-referenceerror.md`.
 * Expected RED today: parity 1–7, 9, 13, 14, 15 (every decode failure
 * `ReferenceError: SharedArrayBuffer is not defined`) + parity 12 (every
 * poisoned decode trips the counting accessor). Green pins: preconditions
 * (incl. response-header provenance) + parity 10. Parity 8 exactness pins and
 * the COI twin of the parity 13 call log are vitest
 * (`packages/runtime-js/src/ipc/worker-realm-compat.test.ts`).
 */
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

type Attempt = { ok: true; value: unknown } | { ok: false; errName: string; errMsg: string };

interface SelfSnapshot {
  isGlobalThis: boolean;
  hasOwn: boolean;
  ownWritableData: boolean;
}

/** Per-decode record of what reached the ORIGINAL decoder (probe-lib
 * `orderedExactCallSweep`) — bytes as plain array, or length+SHA-256 past 16. */
interface ExactCallRow {
  newCalls: number;
  retSentinel: boolean;
  isSource: boolean;
  backingBrand: string;
  bytes: number[] | { length: number; sha256: string } | null;
  optsExact: boolean;
}

type ExactCallRowName =
  | 'priv'
  | 'privDataView'
  | 'privArrayBuffer'
  | 'noArg'
  | 'sharedView'
  | 'sharedDataView'
  | 'rawShared'
  | 'stream1'
  | 'stream2';

interface ProbeResult {
  mode: 'direct' | 'aggregate';
  crossOriginIsolated: unknown;
  sabBindingTypeof: string;
  responseHeaders: Record<
    'document' | 'workerScript' | 'probeModule' | 'builtShim' | 'builtUtilTypes',
    { status: number; coop: string | null; coep: string | null }
  >;
  wasmSharedBrand: string;
  wasmSharedInstanceofArrayBuffer: boolean;
  native: Record<
    'bytes' | 'noArg' | 'sharedView' | 'sharedDataView' | 'rawShared' | 'streaming',
    Attempt
  >;
  firstInstall: boolean;
  // Aggregate only: sibling effects snapshot IMMEDIATELY after call ONE.
  afterFirstInstall?: {
    marker: boolean;
    globalAlias: boolean;
    self: SelfSnapshot;
    selfAssign: Attempt;
    decodeBytes: Attempt;
  };
  marker: boolean;
  repeatDirectReturned: boolean;
  repeatIdentity: boolean;
  // Direct only: FIRST aggregate call lands on an already-marked decoder.
  mixedDirectThenAggregate?: {
    decoderIdentity: boolean;
    marker: boolean;
    globalAlias: boolean;
    self: SelfSnapshot;
    decodeBytes: Attempt;
  };
  patched: Record<
    | 'bytes'
    | 'noArg'
    | 'sharedView'
    | 'sharedDataView'
    | 'rawShared'
    | 'streaming'
    | 'privDataView'
    | 'privArrayBuffer',
    Attempt
  >;
  utilTypes: Attempt;
  identity: Record<
    'view' | 'dataView' | 'arrayBuffer' | 'noArg' | 'errorIdentity' | 'errorIdentitySharedFirst',
    Attempt
  > & {
    errorFirstShared: Record<'sharedView' | 'sharedDataView' | 'rawShared' | 'streaming', Attempt>;
  };
  exactCallLog: Record<'direct' | 'aggregate', Attempt>;
  poisonedBinding: {
    count: number;
    sweep: Record<
      'bytes' | 'noArg' | 'sharedView' | 'sharedDataView' | 'rawShared' | 'streaming',
      Attempt
    >;
  };
}

// EXACT whole-buffer oracle text (Node-verified via the committed transcript):
// 0x00 → U+0000, invalid 0xFF → U+FFFD each, 'hello' at [3,8). Pinned as
// length + SHA-256 — a digest is exact where projections collide.
const RAW_TEXT = `\u0000\ufffd\ufffdhello\ufffd\ufffd${'\u0000'.repeat(65526)}`;
const RAW_EXACT = {
  length: 65536,
  sha256: createHash('sha256').update(RAW_TEXT, 'utf8').digest('hex'),
};

const HELLO = [104, 101, 108, 108, 111];

// The BYTES the original decoder must receive for the raw-shared row of the
// exact-call sweep: the whole sentinel-laid 64KiB buffer, privately copied.
const RAW_BYTES = Buffer.alloc(65536);
RAW_BYTES[1] = 0xff;
RAW_BYTES[2] = 0xff;
RAW_BYTES.set(HELLO, 3);
RAW_BYTES[8] = 0xff;
RAW_BYTES[9] = 0xff;
const RAW_BYTES_EXACT = {
  length: 65536,
  sha256: createHash('sha256').update(RAW_BYTES).digest('hex'),
};

function pass(bytes: number[]): ExactCallRow {
  return {
    newCalls: 1,
    retSentinel: true,
    isSource: true,
    backingBrand: '[object ArrayBuffer]',
    bytes,
    optsExact: true,
  };
}
function copy(bytes: ExactCallRow['bytes']): ExactCallRow {
  return {
    newCalls: 1,
    retSentinel: true,
    isSource: false,
    backingBrand: '[object ArrayBuffer]',
    bytes,
    optsExact: true,
  };
}

/** Green shape of one exact-call sweep: EXACTLY one original call per decode,
 * priv classes + no-arg pass the source object through, shared classes carry a
 * private ([object ArrayBuffer]) copy — never the source — bytes/opts exact,
 * unique sentinel returns unchanged. */
const EXACT_SWEEP_GREEN: { callCount: number; rows: Record<ExactCallRowName, ExactCallRow> } = {
  callCount: 9,
  rows: {
    priv: pass(HELLO),
    privDataView: pass(HELLO),
    privArrayBuffer: pass(HELLO),
    noArg: {
      newCalls: 1,
      retSentinel: true,
      isSource: true,
      backingBrand: '[object Undefined]',
      bytes: null,
      optsExact: true,
    },
    sharedView: copy(HELLO),
    sharedDataView: copy(HELLO),
    rawShared: copy(RAW_BYTES_EXACT),
    stream1: copy([0xc3]),
    stream2: copy([0xa9]),
  },
};

const COMBOS = [
  ['page', 'direct'],
  ['page', 'aggregate'],
  ['worker', 'direct'],
  ['worker', 'aggregate'],
] as const;
type ComboKey = `${(typeof COMBOS)[number][0]}-${(typeof COMBOS)[number][1]}`;

const results = new Map<ComboKey, ProbeResult>();

test.beforeAll(async ({ browser }) => {
  for (const [realm, mode] of COMBOS) {
    // Fresh page per combo: TextDecoder.prototype patching is realm-global.
    const page = await browser.newPage();
    try {
      await page.goto('/index.html');
      const result =
        realm === 'page'
          ? await page.evaluate(async (m) => {
              const libPath = '/probe-lib.mjs';
              const lib = await import(/* @vite-ignore */ libPath);
              return (await lib.runProbe(m)) as ProbeResult;
            }, mode)
          : await page.evaluate(async (m) => {
              const worker = new Worker(`/probe-worker.mjs?mode=${m}`, { type: 'module' });
              const msg = await new Promise<{ ok: boolean; result?: ProbeResult; error?: string }>(
                (resolve, reject) => {
                  worker.onmessage = (e) => resolve(e.data);
                  worker.onerror = (e) => reject(new Error(`worker error: ${e.message}`));
                },
              );
              worker.terminate();
              if (!msg.ok || msg.result === undefined) {
                throw new Error(`probe failed in worker: ${msg.error ?? 'no result'}`);
              }
              return msg.result;
            }, mode);
      results.set(`${realm}-${mode}`, result);
    } finally {
      await page.close();
    }
  }
});

function each(fn: (combo: ComboKey, r: ProbeResult) => void): void {
  for (const [combo, r] of results) fn(combo, r);
}

test('preconditions: crossOriginIsolated===false, no SAB binding, shared wasm memory EXISTS (probe rows 1–2), NO COOP/COEP on any response class (row 16)', () => {
  expect(results.size).toBe(4);
  each((combo, r) => {
    expect(r.crossOriginIsolated, combo).toBe(false);
    expect(r.sabBindingTypeof, combo).toBe('undefined');
    // The killed frozen assumption: shared BufferSource exists without COI.
    expect(r.wasmSharedBrand, combo).toBe('[object SharedArrayBuffer]');
    expect(r.wasmSharedInstanceofArrayBuffer, combo).toBe(false);
    // Header provenance: derived state alone lies — a server adding ONLY COOP
    // or ONLY COEP still reports crossOriginIsolated === false. BOTH headers
    // must be absent on EVERY response class the substrate consumes.
    for (const cls of [
      'document',
      'workerScript',
      'probeModule',
      'builtShim',
      'builtUtilTypes',
    ] as const) {
      expect(r.responseHeaders[cls], `${combo} ${cls}`).toEqual({
        status: 200,
        coop: null,
        coep: null,
      });
    }
  });
});

test('parity 1: patched decode(bytes("hello")) → "hello" in page+worker, direct+aggregate', () => {
  each((combo, r) => {
    expect(r.patched.bytes, combo).toEqual({ ok: true, value: 'hello' });
  });
});

test('parity 2: patched decode() → "" (no-arg)', () => {
  each((combo, r) => {
    expect(r.patched.noArg, combo).toEqual({ ok: true, value: '' });
  });
});

test('parity 3: shared-wasm Uint8Array view AND DataView, "hello" bytes at offset 3 len 5 → "hello" (Node oracle)', () => {
  each((combo, r) => {
    expect(r.patched.sharedView, combo).toEqual({ ok: true, value: 'hello' });
    // Sibling view class — a Uint8Array-only branch must not pass.
    expect(r.patched.sharedDataView, combo).toEqual({ ok: true, value: 'hello' });
  });
});

test('parity 4: raw shared-wasm buffer → whole-buffer text EXACT (length + SHA-256, Node-identical)', () => {
  each((combo, r) => {
    expect(r.patched.rawShared, combo).toEqual({ ok: true, value: RAW_EXACT });
  });
});

test('parity 5: "é" split across two shared-backed views, {stream:true}, ONE decoder → ["", "é"]', () => {
  each((combo, r) => {
    expect(r.patched.streaming, combo).toEqual({ ok: true, value: ['', 'é'] });
  });
});

test('parity 6: aggregate call ONE — global alias + own writable self (pre-write value, hasOwn, descriptor, assignment) + marker + decode green together', () => {
  each((combo, r) => {
    if (r.mode !== 'aggregate') return;
    expect(r.firstInstall, combo).toBe(true);
    const a = r.afterFirstInstall;
    expect(a, combo).toBeDefined();
    if (a === undefined) return;
    // Snapshot taken IMMEDIATELY after the first installWorkerRealmCompat() —
    // a sibling effect only observable after a second call fails here.
    expect(a.marker, combo).toBe(true);
    expect(a.globalAlias, combo).toBe(true);
    // self BEFORE any probe write: own writable DATA property valued
    // globalThis — self=null or an inherited setter fails here.
    expect(a.self, combo).toEqual({ isGlobalThis: true, hasOwn: true, ownWritableData: true });
    expect(a.selfAssign, combo).toEqual({ ok: true, value: true });
    // No guard may skip a sibling installer: decode green at call one too.
    expect(a.decodeBytes, combo).toEqual({ ok: true, value: 'hello' });
  });
});

test('parity 7: repeat install → false AND strict-identity patched fn AND shared decode still green', () => {
  each((combo, r) => {
    expect(r.firstInstall, combo).toBe(true);
    expect(r.marker, combo).toBe(true);
    expect(r.repeatDirectReturned, combo).toBe(false);
    expect(r.repeatIdentity, combo).toBe(true);
    // Booleans alone don't close this: decode must still work after repeats.
    expect(r.patched.sharedView, combo).toEqual({ ok: true, value: 'hello' });
  });
});

test('parity 9: spy identity + unique sentinel returns per non-shared class; thrown error = the FIRST error object, throw count 1, shared-wasm input included', () => {
  each((combo, r) => {
    // Exact input/opts objects AND the spy's unique sentinel returned unchanged
    // — a wrapper passing exact objects but fabricating output fails here.
    expect(r.identity.view, combo).toEqual({ ok: true, value: true });
    expect(r.identity.dataView, combo).toEqual({ ok: true, value: true });
    expect(r.identity.arrayBuffer, combo).toEqual({ ok: true, value: true });
    expect(r.identity.noArg, combo).toEqual({ ok: true, value: true });
    expect(r.identity.errorIdentity, combo).toEqual({ ok: true, value: true });
    // Shared-wasm input, fresh error per call: the propagated error must be
    // the FIRST thrown object with throw count EXACTLY 1 — a try-native/
    // catch/copy-retry wrapper throws twice and propagates the second.
    expect(r.identity.errorIdentitySharedFirst, combo).toEqual({
      ok: true,
      value: { first: true, throwCount: 1 },
    });
    // Sibling sweep — fresh TypeError per call, EVERY shared class: a
    // native-first wrapper retrying only on TypeError passes the generic-Error
    // row, and a Uint8Array-only row misses a DataView/raw/streaming branch.
    for (const cls of ['sharedView', 'sharedDataView', 'rawShared', 'streaming'] as const) {
      expect(r.identity.errorFirstShared[cls], `${combo} ${cls}`).toEqual({
        ok: true,
        value: { first: true, throwCount: 1 },
      });
    }
  });
});

test('parity 13: ordered exact-call log — original invoked EXACTLY once per decode; only shared-source calls get a private copy (direct+aggregate)', () => {
  // Output and error-identity rows alone admit a native-first retry wrapper
  // that hands the ORIGINAL decoder the shared source before copying.
  each((combo, r) => {
    expect(r.exactCallLog.direct, `${combo} direct`).toEqual({
      ok: true,
      value: EXACT_SWEEP_GREEN,
    });
    expect(r.exactCallLog.aggregate, `${combo} aggregate`).toEqual({
      ok: true,
      value: EXACT_SWEEP_GREEN,
    });
  });
});

test('parity 14: direct helper install THEN first aggregate call — decoder identity kept AND global/self siblings still install (no marker early-return)', () => {
  each((combo, r) => {
    if (r.mode !== 'direct') return;
    const m = r.mixedDirectThenAggregate;
    expect(m, combo).toBeDefined();
    if (m === undefined) return;
    expect(m.decoderIdentity, combo).toBe(true);
    expect(m.marker, combo).toBe(true);
    expect(m.globalAlias, combo).toBe(true);
    expect(m.self, combo).toEqual({ isGlobalThis: true, hasOwn: true, ownWritableData: true });
    expect(m.decodeBytes, combo).toEqual({ ok: true, value: 'hello' });
  });
});

test('parity 15: non-shared DataView / ArrayBuffer through the realm decoder → "hello" (direct+aggregate)', () => {
  each((combo, r) => {
    expect(r.patched.privDataView, combo).toEqual({ ok: true, value: 'hello' });
    expect(r.patched.privArrayBuffer, combo).toEqual({ ok: true, value: 'hello' });
  });
});

test('parity 12: poisoned binding — patched decode sweep NEVER evaluates bare SharedArrayBuffer (count 0), outputs intact', () => {
  // Kills the frozen assumption that output rows alone pin the fix carrier: a
  // try/catch over the bare identifier passes parity 1–5 yet counts here.
  each((combo, r) => {
    expect(r.poisonedBinding.count, combo).toBe(0);
    const s = r.poisonedBinding.sweep;
    expect(s.bytes, combo).toEqual({ ok: true, value: 'hello' });
    expect(s.noArg, combo).toEqual({ ok: true, value: '' });
    expect(s.sharedView, combo).toEqual({ ok: true, value: 'hello' });
    expect(s.sharedDataView, combo).toEqual({ ok: true, value: 'hello' });
    expect(s.rawShared, combo).toEqual({ ok: true, value: RAW_EXACT });
    expect(s.streaming, combo).toEqual({ ok: true, value: ['', 'é'] });
  });
});

test('parity 10: built util-types Node-identical incl. shared-wasm buffer, no throw (GREEN pin)', () => {
  // Node column provenance: the transcript's `utilTypesNative` rows run the
  // REAL node:util/types on the same inputs (differential, not a rifty re-run).
  each((combo, r) => {
    expect(r.utilTypes, combo).toEqual({
      ok: true,
      value: {
        privateIsShared: false,
        privateIsAny: true,
        sharedWasmIsShared: true,
        sharedWasmIsAny: true,
      },
    });
  });
});
