/**
 * RED-first no-COI substrate — contract
 * `docs/backlog/runtime-js/worker-realm-compat-bare-sab-referenceerror.md`.
 *
 * Real Chromium, headerless page (no COOP/COEP) + dedicated module Worker,
 * REAL BUILT shim (esbuild of `packages/runtime-js/src/ipc/worker-realm-compat.ts`),
 * page/Worker × direct/aggregate install, every declared input class.
 *
 * Expected RED today (declared band, 7 tests): parity 1–7 — after install every
 * `decode()` throws `ReferenceError: SharedArrayBuffer is not defined`
 * (worker-realm-compat.ts:75,80 bare references). GREEN pins: preconditions +
 * parity 10 (built util-types). Parity 8–9 exactness/identity pins are
 * COI-unit vitest (`packages/runtime-js/src/ipc/worker-realm-compat.test.ts`);
 * the probe records their evidence rows for the replayable driver
 * (`tools/probes/no-coi-realm-probe.mjs`).
 */
import { expect, test } from '@playwright/test';

type Attempt = { ok: true; value: unknown } | { ok: false; errName: string; errMsg: string };

interface ProbeResult {
  mode: 'direct' | 'aggregate';
  crossOriginIsolated: unknown;
  sabBindingTypeof: string;
  wasmSharedBrand: string;
  wasmSharedInstanceofArrayBuffer: boolean;
  native: Record<'bytes' | 'noArg' | 'sharedView' | 'rawShared' | 'streaming', Attempt>;
  firstInstall: boolean;
  marker: boolean;
  repeatDirectReturned: boolean;
  repeatIdentity: boolean;
  patched: Record<
    'bytes' | 'noArg' | 'sharedView' | 'sharedDataView' | 'rawShared' | 'streaming',
    Attempt
  >;
  globalAlias: boolean;
  selfWritable: Attempt;
  utilTypes: Attempt;
  identity: Record<'view' | 'dataView' | 'arrayBuffer' | 'noArg' | 'errorIdentity', Attempt>;
}

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

test('parity 3: shared-wasm view, "hello" bytes at offset 3 len 5 → "hello" (Node oracle)', () => {
  each((combo, r) => {
    expect(r.patched.sharedView, combo).toEqual({ ok: true, value: 'hello' });
  });
});

test('parity 4: raw shared-wasm buffer → whole-buffer text, Node-identical (65536 chars, sentinels exact)', () => {
  each((combo, r) => {
    // 4 non-NUL chars outside the view = the 0xFF sentinels (U+FFFD each);
    // 'hello' sits exactly at [3,8). Anything else = wrong bytes decoded.
    expect(r.patched.rawShared, combo).toEqual({
      ok: true,
      value: { length: 65536, atOffset: 'hello', nonNul: 4 },
    });
  });
});

test('parity 5: "é" split across two shared-backed views, {stream:true}, ONE decoder → ["", "é"]', () => {
  each((combo, r) => {
    expect(r.patched.streaming, combo).toEqual({ ok: true, value: ['', 'é'] });
  });
});

test('parity 6: aggregate installWorkerRealmCompat — global alias + writable self + marker + decode green together', () => {
  each((combo, r) => {
    if (r.mode !== 'aggregate') return;
    expect(r.firstInstall, combo).toBe(true);
    expect(r.globalAlias, combo).toBe(true);
    expect(r.selfWritable, combo).toEqual({ ok: true, value: true });
    expect(r.marker, combo).toBe(true);
    // No guard may skip a sibling installer: decode must be green here too.
    expect(r.patched.bytes, combo).toEqual({ ok: true, value: 'hello' });
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

test('parity 10: built util-types Node-identical incl. shared-wasm buffer, no throw (GREEN pin)', () => {
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
