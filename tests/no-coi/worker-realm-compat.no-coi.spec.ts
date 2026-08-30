/**
 * no-COI substrate preconditions — lane contract
 * `docs/backlog/toolchain-build/no-coi-substrate-lane.md` (ADR-0369). GREEN
 * pins only: realm reality (crossOriginIsolated===false, absent
 * `SharedArrayBuffer` binding, shared `WebAssembly.Memory` EXISTS — probe rows
 * 1–2) + consumed-response header provenance (row 16) across all four
 * realm×install combos, and precondition-REJECTION detection (every violated
 * predicate sibling rejects before any import/install/decode — actual decode
 * counter, not just marker/request sentinels).
 *
 * The TextDecoder shim behavior contract and its expected-RED batch belong to
 * `runtime-js/worker-realm-compat-bare-sab-referenceerror` — DRAFT since its
 * checkpoint-8 demotion, so the batch carries NO tests on this branch (a draft
 * is never implemented; verbatim batch:
 * `docs/backlog/runtime-js/reference/bare-sab-guard-pre-demotion-2026-08-30.md`
 * + git history). When it re-compiles to ready, its Contract+RED re-commits
 * the substrate REDs here, keeping the required `no-coi-chromium` job red
 * until the fix (ADR-0369 + dated correction).
 */
import { expect, test } from '@playwright/test';
import {
  CONSUMED_CLASSES,
  type ConsumedClassSummary,
  assertHeaderlessConsumption,
  captureConsumedResponses,
  summarizeConsumedResponses,
} from './header-provenance.mjs';

/** Realm-precondition slice of the probe result (`probe-lib.mjs` runProbe). */
interface ProbePreconditions {
  mode: 'direct' | 'aggregate';
  crossOriginIsolated: unknown;
  sabBindingTypeof: string;
  wasmSharedBrand: string;
  wasmSharedInstanceofArrayBuffer: boolean;
}

const COMBOS = [
  ['page', 'direct'],
  ['page', 'aggregate'],
  ['worker', 'direct'],
  ['worker', 'aggregate'],
] as const;
type ComboKey = `${(typeof COMBOS)[number][0]}-${(typeof COMBOS)[number][1]}`;

const results = new Map<ComboKey, ProbePreconditions>();
const consumedHeaders = new Map<ComboKey, ConsumedClassSummary>();

test.beforeAll(async ({ browser }) => {
  for (const [realm, mode] of COMBOS) {
    // Fresh page per combo: TextDecoder.prototype patching is realm-global.
    const page = await browser.newPage();
    try {
      // Header provenance on the ACTUALLY consumed responses (attach before
      // navigation) — an in-page re-fetch sweep cannot observe these.
      const capture = captureConsumedResponses(page);
      await page.goto('/index.html');
      const result =
        realm === 'page'
          ? await page.evaluate(async (m) => {
              const libPath = '/probe-lib.mjs';
              const lib = await import(/* @vite-ignore */ libPath);
              return (await lib.runProbe(m)) as ProbePreconditions;
            }, mode)
          : await page.evaluate(async (m) => {
              const worker = new Worker(`/probe-worker.mjs?mode=${m}`, { type: 'module' });
              const msg = await new Promise<{
                ok: boolean;
                result?: ProbePreconditions;
                error?: string;
              }>((resolve, reject) => {
                worker.onmessage = (e) => resolve(e.data);
                worker.onerror = (e) => reject(new Error(`worker error: ${e.message}`));
              });
              worker.terminate();
              if (!msg.ok || msg.result === undefined) {
                throw new Error(`probe failed in worker: ${msg.error ?? 'no result'}`);
              }
              return msg.result;
            }, mode);
      const responses = await capture.settle();
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

test('preconditions: crossOriginIsolated===false, no SAB binding, shared wasm memory EXISTS (probe rows 1–2), NO COOP/COEP on any CONSUMED response class (row 16)', () => {
  expect(results.size).toBe(4);
  for (const [combo, r] of results) {
    expect(r.crossOriginIsolated, combo).toBe(false);
    expect(r.sabBindingTypeof, combo).toBe('undefined');
    // The killed frozen assumption: shared BufferSource exists without COI.
    expect(r.wasmSharedBrand, combo).toBe('[object SharedArrayBuffer]');
    expect(r.wasmSharedInstanceofArrayBuffer, combo).toBe(false);
    // Header provenance on the responses the realm ACTUALLY consumed, keyed
    // path + destination (derived state passes a one-header server; an
    // in-page re-fetch sweep passes a destination-keyed one; a pathname-only
    // match passes a destination-only-404 one — detection controls:
    // header-provenance.no-coi.spec.ts). BOTH headers absent on every class.
    const [realm] = combo.split('-') as ['page' | 'worker'];
    const consumed = consumedHeaders.get(combo);
    expect(consumed, combo).toBeDefined();
    for (const cls of Object.keys(CONSUMED_CLASSES[realm])) {
      expect(consumed?.[cls], `${combo} ${cls}`).toEqual({ status: 200, coop: null, coep: null });
    }
  }
});

/**
 * Precondition-rejection detection (GREEN pins): recording a violated
 * precondition while acting anyway is a frozen assumption — a wrong realm must
 * REJECT before ANY action. Swept across EVERY predicate sibling of the gate
 * (`crossOriginIsolated` / SAB binding present / wrong shared-memory brand /
 * `instanceof ArrayBuffer` true) × page AND Worker realms. Order is proven by
 * side-effect sentinels PLUS an ACTUAL decode counter: a spy over the real
 * `TextDecoder.prototype.decode` installed before the probe — an unpatched
 * NATIVE decode before the gate leaves no `__riftyShared` marker and no
 * /dist/ request, only the counter (EXACTLY 0 at rejection) sees it.
 */
const PRECONDITION_POISONS = [
  { kind: 'coi', names: /crossOriginIsolated=true/ },
  { kind: 'sab', names: /typeof SharedArrayBuffer=function/ },
  { kind: 'brand', names: /brand=\[object ArrayBuffer\]/ },
  { kind: 'instanceof', names: /instanceof ArrayBuffer: true/ },
] as const;

for (const realm of ['page', 'worker'] as const) {
  for (const { kind, names } of PRECONDITION_POISONS) {
    test(`precondition detection (${realm}, ${kind}): violated predicate rejects BEFORE any import/install/decode — decode count 0`, async ({
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
            ? await page.evaluate(async (poison) => {
                if (poison === 'coi') {
                  Object.defineProperty(globalThis, 'crossOriginIsolated', {
                    configurable: true,
                    value: true,
                  });
                } else if (poison === 'sab') {
                  (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer =
                    function SharedArrayBuffer() {};
                } else if (poison === 'brand') {
                  // Wrong-brand realm sim: shared memory whose .buffer is PRIVATE.
                  (WebAssembly as unknown as { Memory: unknown }).Memory = class {
                    buffer = new ArrayBuffer(65536);
                  };
                } else {
                  // Right brand, wrong prototype chain: instanceof stays true.
                  class FakeSharedArrayBuffer extends ArrayBuffer {}
                  Object.defineProperty(FakeSharedArrayBuffer.prototype, Symbol.toStringTag, {
                    configurable: true,
                    get: () => 'SharedArrayBuffer',
                  });
                  (WebAssembly as unknown as { Memory: unknown }).Memory = class {
                    buffer = new FakeSharedArrayBuffer(65536);
                  };
                }
                // ACTUAL decode counter — installed BEFORE the probe module
                // ever loads; counts native decodes the marker sentinel misses.
                const realDecode = TextDecoder.prototype.decode;
                let decodeCalls = 0;
                TextDecoder.prototype.decode = function decode(
                  this: TextDecoder,
                  ...args: Parameters<TextDecoder['decode']>
                ) {
                  decodeCalls += 1;
                  return realDecode.apply(this, args);
                };
                const libPath = '/probe-lib.mjs';
                const lib = await import(/* @vite-ignore */ libPath);
                try {
                  await lib.runProbe('direct');
                  return { rejected: false, error: '', decodeMarked: true, decodeCalls };
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
                    decodeCalls,
                  };
                }
              }, kind)
            : await page.evaluate(async (poison) => {
                const worker = new Worker(`/probe-worker.mjs?mode=direct&poison=${poison}`, {
                  type: 'module',
                });
                const msg = await new Promise<{
                  ok: boolean;
                  error?: string;
                  decodeMarked?: boolean;
                  decodeCalls?: number;
                }>((resolve, reject) => {
                  worker.onmessage = (e) => resolve(e.data);
                  worker.onerror = (e) => reject(new Error(`worker error: ${e.message}`));
                });
                worker.terminate();
                return {
                  rejected: !msg.ok,
                  error: msg.error ?? '',
                  decodeMarked: msg.decodeMarked === true,
                  decodeCalls: msg.decodeCalls ?? -1,
                };
              }, kind);
        // Rejection happened and NAMED the violated predicate.
        expect(out.rejected, `${realm} ${kind}`).toBe(true);
        expect(out.error, `${realm} ${kind}`).toMatch(/precondition violated/);
        expect(out.error, `${realm} ${kind}`).toMatch(names);
        // Side-effect sentinels: rejection PRECEDED every action — the realm
        // decode was never patched, no built module was ever requested, and
        // NOT ONE decode (patched OR native) ran before the gate.
        expect(out.decodeMarked, `${realm} ${kind}`).toBe(false);
        expect(out.decodeCalls, `${realm} ${kind}`).toBe(0);
        expect(distRequests, `${realm} ${kind}`).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }
}
