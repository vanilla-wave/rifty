/**
 * RED-first no-COI substrate — contract
 * `docs/backlog/runtime-js/worker-realm-compat-bare-sab-referenceerror.md`.
 * Expected RED today: parity 1–7 (every failure `ReferenceError:
 * SharedArrayBuffer is not defined`) + parity 12 (every poisoned decode trips
 * the counting accessor). Green pins: preconditions + parity 10.
 * Parity 8–9 exactness/identity pins are COI vitest
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
  patched: Record<
    'bytes' | 'noArg' | 'sharedView' | 'sharedDataView' | 'rawShared' | 'streaming',
    Attempt
  >;
  utilTypes: Attempt;
  identity: Record<'view' | 'dataView' | 'arrayBuffer' | 'noArg' | 'errorIdentity', Attempt>;
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

test('preconditions: crossOriginIsolated===false, no SAB binding, shared wasm memory EXISTS (probe rows 1–2)', () => {
  expect(results.size).toBe(4);
  each((combo, r) => {
    expect(r.crossOriginIsolated, combo).toBe(false);
    expect(r.sabBindingTypeof, combo).toBe('undefined');
    // The killed frozen assumption: shared BufferSource exists without COI.
    expect(r.wasmSharedBrand, combo).toBe('[object SharedArrayBuffer]');
    expect(r.wasmSharedInstanceofArrayBuffer, combo).toBe(false);
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
