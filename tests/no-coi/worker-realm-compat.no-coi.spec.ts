/**
 * RED-first no-COI substrate — contract
 * `docs/backlog/runtime-js/worker-realm-compat-bare-sab-referenceerror.md`.
 * Expected RED today: parity 1–7, 9, 13, 14, 15 (every decode failure
 * `ReferenceError: SharedArrayBuffer is not defined`) + parity 12 (every
 * poisoned decode trips the counting accessor). Green pins: preconditions
 * (incl. consumed-response header provenance — lane contract
 * `docs/backlog/toolchain-build/no-coi-substrate-lane.md`) + parity 10 +
 * precondition-rejection detection.
 * Parity 8 exactness pins and the COI twins of the parity 9/13 sweeps are
 * vitest (`packages/runtime-js/src/ipc/worker-realm-compat.test.ts`).
 *
 * The RED batch is runner-DECLARED via `test.fail(true, EXPECTED_RED)`: every
 * RED test still RUNS and must FAIL — an unexpected pass fails the lane LOUD,
 * so the fix PR must strip exactly these annotations (assertions are never
 * edited). This keeps the required `no-coi-chromium` job green between slices
 * (the lane item lands serially before the fix) while the REDs stay executed
 * and machine-flip-detected.
 */
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  CONSUMED_CLASSES,
  type ConsumedClassSummary,
  assertHeaderlessConsumption,
  captureConsumedResponses,
  summarizeConsumedResponses,
} from './header-provenance.mjs';

const EXPECTED_RED =
  'declared RED — runtime-js/worker-realm-compat-bare-sab-referenceerror; the fix PR strips this line (an unexpected pass fails the lane loud)';

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

type ErrorFirstRow = Attempt; // green value: { first: true, throwCount: 1 } (+ originalCalls: 2 on streamingFinal)
type ErrorFirstOptsFalseName =
  | 'privOptsFalse'
  | 'privDataViewOptsFalse'
  | 'privArrayBufferOptsFalse'
  | 'sharedViewOptsFalse'
  | 'sharedDataViewOptsFalse'
  | 'rawSharedOptsFalse'
  | 'streamingFinal';
type ErrorFirstClassName =
  | 'priv'
  | 'privDataView'
  | 'privArrayBuffer'
  | 'noArg'
  | 'sharedView'
  | 'sharedDataView'
  | 'rawShared'
  | 'streaming'
  | ErrorFirstOptsFalseName;

interface ProbeResult {
  mode: 'direct' | 'aggregate';
  crossOriginIsolated: unknown;
  sabBindingTypeof: string;
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
    errorFirstShared: Record<
      'sharedView' | 'sharedDataView' | 'rawShared' | 'streaming',
      ErrorFirstRow
    >;
    errorFirstPrivate: Record<'priv' | 'privDataView' | 'privArrayBuffer' | 'noArg', ErrorFirstRow>;
    errorFirstOptsFalse: Record<ErrorFirstOptsFalseName, ErrorFirstRow>;
  };
  exactCallLog: Record<'direct' | 'aggregate', Attempt>;
  errorFirstRealm: Record<'direct' | 'aggregate', Record<ErrorFirstClassName, ErrorFirstRow>>;
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
const consumedHeaders = new Map<ComboKey, ConsumedClassSummary>();

test.beforeAll(async ({ browser }) => {
  for (const [realm, mode] of COMBOS) {
    // Fresh page per combo: TextDecoder.prototype patching is realm-global.
    const page = await browser.newPage();
    try {
      // Header provenance on the ACTUALLY consumed responses (attach before
      // navigation) — an in-page re-fetch sweep cannot observe these.
      const responses = captureConsumedResponses(page);
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
      assertHeaderlessConsumption(responses, CONSUMED_CLASSES[realm]);
      consumedHeaders.set(
        `${realm}-${mode}`,
        summarizeConsumedResponses(responses, CONSUMED_CLASSES[realm]),
      );
      results.set(`${realm}-${mode}`, result);
    } finally {
      await page.close();
    }
  }
});

function each(fn: (combo: ComboKey, r: ProbeResult) => void): void {
  for (const [combo, r] of results) fn(combo, r);
}

test('preconditions: crossOriginIsolated===false, no SAB binding, shared wasm memory EXISTS (probe rows 1–2), NO COOP/COEP on any CONSUMED response class (row 16)', () => {
  expect(results.size).toBe(4);
  each((combo, r) => {
    expect(r.crossOriginIsolated, combo).toBe(false);
    expect(r.sabBindingTypeof, combo).toBe('undefined');
    // The killed frozen assumption: shared BufferSource exists without COI.
    expect(r.wasmSharedBrand, combo).toBe('[object SharedArrayBuffer]');
    expect(r.wasmSharedInstanceofArrayBuffer, combo).toBe(false);
    // Header provenance on the responses the realm ACTUALLY consumed (derived
    // state passes a one-header server; an in-page re-fetch sweep passes a
    // destination-keyed one — injection controls:
    // header-provenance.no-coi.spec.ts). BOTH headers absent on every class.
    const [realm] = combo.split('-') as ['page' | 'worker'];
    const consumed = consumedHeaders.get(combo);
    expect(consumed, combo).toBeDefined();
    for (const cls of Object.keys(CONSUMED_CLASSES[realm])) {
      expect(consumed?.[cls], `${combo} ${cls}`).toEqual({ status: 200, coop: null, coep: null });
    }
  });
});

test('parity 1: patched decode(bytes("hello")) → "hello" in page+worker, direct+aggregate', () => {
  test.fail(true, EXPECTED_RED);
  each((combo, r) => {
    expect(r.patched.bytes, combo).toEqual({ ok: true, value: 'hello' });
  });
});

test('parity 2: patched decode() → "" (no-arg)', () => {
  test.fail(true, EXPECTED_RED);
  each((combo, r) => {
    expect(r.patched.noArg, combo).toEqual({ ok: true, value: '' });
  });
});

test('parity 3: shared-wasm Uint8Array view AND DataView, "hello" bytes at offset 3 len 5 → "hello" (Node oracle)', () => {
  test.fail(true, EXPECTED_RED);
  each((combo, r) => {
    expect(r.patched.sharedView, combo).toEqual({ ok: true, value: 'hello' });
    // Sibling view class — a Uint8Array-only branch must not pass.
    expect(r.patched.sharedDataView, combo).toEqual({ ok: true, value: 'hello' });
  });
});

test('parity 4: raw shared-wasm buffer → whole-buffer text EXACT (length + SHA-256, Node-identical)', () => {
  test.fail(true, EXPECTED_RED);
  each((combo, r) => {
    expect(r.patched.rawShared, combo).toEqual({ ok: true, value: RAW_EXACT });
  });
});

test('parity 5: "é" split across two shared-backed views, {stream:true}, ONE decoder → ["", "é"]', () => {
  test.fail(true, EXPECTED_RED);
  each((combo, r) => {
    expect(r.patched.streaming, combo).toEqual({ ok: true, value: ['', 'é'] });
  });
});

test('parity 6: aggregate call ONE — global alias + own writable self (pre-write value, hasOwn, descriptor, assignment) + marker + decode green together', () => {
  test.fail(true, EXPECTED_RED);
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
  test.fail(true, EXPECTED_RED);
  each((combo, r) => {
    expect(r.firstInstall, combo).toBe(true);
    expect(r.marker, combo).toBe(true);
    expect(r.repeatDirectReturned, combo).toBe(false);
    expect(r.repeatIdentity, combo).toBe(true);
    // Booleans alone don't close this: decode must still work after repeats.
    expect(r.patched.sharedView, combo).toEqual({ ok: true, value: 'hello' });
  });
});

test('parity 9: spy identity + unique sentinel returns; FIRST-error identity with throw count 1 — shared AND private classes, injected AND realm-decoder direct+aggregate carriers', () => {
  test.fail(true, EXPECTED_RED);
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
    // Private siblings + no-arg, same fresh-error discipline: a wrapper
    // retrying only FAILING PRIVATE inputs invokes the original twice — with a
    // reused sentinel it rethrows the same object and passes; count 1 kills it.
    for (const cls of ['priv', 'privDataView', 'privArrayBuffer', 'noArg'] as const) {
      expect(r.identity.errorFirstPrivate[cls], `${combo} ${cls}`).toEqual({
        ok: true,
        value: { first: true, throwCount: 1 },
      });
    }
    // Explicit {stream:false} siblings + the streaming FINAL call: every base
    // row above omits opts (or passes stream:true) and the exact-call log's
    // stream:false rows use a NONTHROWING logger — a wrapper retrying only a
    // THROWN opts.stream===false call passes both; these rows kill it.
    // streamingFinal: original RETURNS on {stream:true}, fresh-throws on the
    // final — first error, count 1, original invoked EXACTLY twice.
    for (const cls of [
      'privOptsFalse',
      'privDataViewOptsFalse',
      'privArrayBufferOptsFalse',
      'sharedViewOptsFalse',
      'sharedDataViewOptsFalse',
      'rawSharedOptsFalse',
    ] as const) {
      expect(r.identity.errorFirstOptsFalse[cls], `${combo} ${cls}`).toEqual({
        ok: true,
        value: { first: true, throwCount: 1 },
      });
    }
    expect(r.identity.errorFirstOptsFalse.streamingFinal, `${combo} streamingFinal`).toEqual({
      ok: true,
      value: { first: true, throwCount: 1, originalCalls: 2 },
    });
    // REALM-decoder carriers (direct AND aggregate), full class set incl. the
    // stream:false siblings: the injected rows alone admit a fix retrying
    // fresh errors only for the absent-binding realm's global TextDecoder.
    for (const carrier of ['direct', 'aggregate'] as const) {
      for (const cls of [
        'priv',
        'privDataView',
        'privArrayBuffer',
        'noArg',
        'sharedView',
        'sharedDataView',
        'rawShared',
        'streaming',
        'privOptsFalse',
        'privDataViewOptsFalse',
        'privArrayBufferOptsFalse',
        'sharedViewOptsFalse',
        'sharedDataViewOptsFalse',
        'rawSharedOptsFalse',
        'streamingFinal',
      ] as const) {
        expect(r.errorFirstRealm[carrier][cls], `${combo} realm-${carrier} ${cls}`).toEqual({
          ok: true,
          value:
            cls === 'streamingFinal'
              ? { first: true, throwCount: 1, originalCalls: 2 }
              : { first: true, throwCount: 1 },
        });
      }
    }
  });
});

test('parity 13: ordered exact-call log — original invoked EXACTLY once per decode; only shared-source calls get a private copy (direct+aggregate)', () => {
  test.fail(true, EXPECTED_RED);
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
  test.fail(true, EXPECTED_RED);
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
  test.fail(true, EXPECTED_RED);
  each((combo, r) => {
    expect(r.patched.privDataView, combo).toEqual({ ok: true, value: 'hello' });
    expect(r.patched.privArrayBuffer, combo).toEqual({ ok: true, value: 'hello' });
  });
});

test('parity 12: poisoned binding — patched decode sweep NEVER evaluates bare SharedArrayBuffer (count 0), outputs intact', () => {
  test.fail(true, EXPECTED_RED);
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

/**
 * Precondition-rejection detection (GREEN pins): recording the shared-memory
 * brand while acting anyway is a frozen assumption — a wrong-brand realm must
 * REJECT before ANY action, proven by side-effect sentinels (no built /dist/
 * module ever requested, realm decode left unmarked), swept through the page
 * AND Worker probe siblings.
 */
for (const realm of ['page', 'worker'] as const) {
  test(`precondition detection (${realm}): wrong shared-memory brand rejects BEFORE any import/install/decode`, async ({
    browser,
  }) => {
    // Fresh page: its module map has never loaded the built /dist/ fixtures.
    const page = await browser.newPage();
    try {
      const distRequests: string[] = [];
      page.on('request', (req) => {
        const p = new URL(req.url()).pathname;
        if (p.startsWith('/dist/')) distRequests.push(p);
      });
      await page.goto('/index.html');
      const out =
        realm === 'page'
          ? await page.evaluate(async () => {
              const wasm = WebAssembly as unknown as { Memory: unknown };
              const RealMemory = wasm.Memory;
              // Wrong-brand realm sim: shared memory whose .buffer is PRIVATE.
              wasm.Memory = class {
                buffer = new ArrayBuffer(65536);
              };
              try {
                const libPath = '/probe-lib.mjs';
                const lib = await import(/* @vite-ignore */ libPath);
                try {
                  await lib.runProbe('direct');
                  return { rejected: false, error: '', decodeMarked: true };
                } catch (err) {
                  return {
                    rejected: true,
                    error: err instanceof Error ? err.message : String(err),
                    decodeMarked:
                      (
                        TextDecoder.prototype.decode as unknown as {
                          __riftyShared?: boolean;
                        }
                      ).__riftyShared === true,
                  };
                }
              } finally {
                wasm.Memory = RealMemory;
              }
            })
          : await page.evaluate(async () => {
              const worker = new Worker('/probe-worker.mjs?mode=direct&poisonWasmBrand=1', {
                type: 'module',
              });
              const msg = await new Promise<{
                ok: boolean;
                error?: string;
                decodeMarked?: boolean;
              }>((resolve, reject) => {
                worker.onmessage = (e) => resolve(e.data);
                worker.onerror = (e) => reject(new Error(`worker error: ${e.message}`));
              });
              worker.terminate();
              return {
                rejected: !msg.ok,
                error: msg.error ?? '',
                decodeMarked: msg.decodeMarked === true,
              };
            });
      // Rejection happened and NAMED the wrong brand.
      expect(out.rejected, realm).toBe(true);
      expect(out.error, realm).toMatch(/precondition violated/);
      expect(out.error, realm).toMatch(/brand=\[object ArrayBuffer\]/);
      // Side-effect sentinels: rejection PRECEDED every action — the realm
      // decode was never patched and no built module was ever requested.
      expect(out.decodeMarked, realm).toBe(false);
      expect(distRequests, realm).toEqual([]);
    } finally {
      await page.close();
    }
  });
}
