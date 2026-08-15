/**
 * Acceptance (issue #256, epic project-open-drain-latency invariant I3,
 * ADR-0358, item vfs/opfs-parallel-write-through-drain): on a real ≥20k-file
 * node_modules tree (the committed 26 811-file gravity-ui manifest — real
 * paths+sizes, procedural bytes) the durability drain completes ≥2.5x faster
 * than the faithful serial baseline measured in the SAME run — asserted on
 * the RAW unrounded ratio, scaled by the calibrated per-op-flush inflation
 * bound — with a clean flush ledger and a fresh-surface WHOLE-TREE
 * durability proof (exact path equality with the manifest walk + BYTE-EXACT
 * reads of ALL files, per fault-classes.md exact-bytes) on both variants.
 *
 * DESIGNED RED on main: enqueuePending chains every op behind pendingTail —
 * the drain is globally serial — so the deduped product drain lands at only
 * ~1.3x over the faithful baseline (< 2.5). Turns GREEN when ADR-0358's
 * bounded ~16-lane per-path parallel drain lands inside OpfsFsSync. See
 * fixtures/opfs-parallel-drain-worker.ts for the measured regimes.
 */
import { type Page, expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/opfs-parallel-drain-worker.ts?worker&url`;
const manifestUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/real-tree-manifest.json`;

/**
 * Upper bound on the faithful baseline's per-op-flush inflation vs the
 * one-final-flush serial regime. Measured pre-implementation (2026-08-15,
 * darwin arm64, main serial drain) via the worker's 'calibrate' phase
 * (calibration test below, PD256_CALIBRATE=1): perOpFlushMs 41423 vs
 * oneFlushMs 41141 → rawRatio 1.0069 on the full 26 811-file manifest.
 * Bound 1.05 gives ~7x headroom over the measured inflation. The I3 gate
 * multiplies by it so an inflated per-op-flush denominator cannot
 * manufacture speedup.
 */
const SERIAL_OVERHEAD_BOUND = 1.05;

interface AcceptanceResult {
  readonly files: number;
  readonly totalBytes: number;
  readonly dirCount: number;
  readonly statsFiles: number;
  readonly statsTotalBytes: number;
  readonly faithfulMs: number;
  readonly productMs: number;
  /** RAW unrounded faithful/product ratio — the asserted I3 gate. */
  readonly speedupRaw: number;
  /** Log convenience only (2-decimal rounding) — never asserted. */
  readonly speedup: number;
  readonly faithfulReportTotal: number;
  readonly productReportTotal: number;
  readonly faithfulTreeVerified: boolean;
  readonly faithfulTreeFiles: number;
  readonly faithfulTreeMismatch: string | null;
  readonly productTreeVerified: boolean;
  readonly productTreeFiles: number;
  readonly productTreeMismatch: string | null;
}

interface CalibrationResult {
  readonly files: number;
  readonly perOpFlushMs: number;
  readonly oneFlushMs: number;
  readonly rawRatio: number;
}

/** Launch the fixture worker, run one phase, await its `{ok,...}` envelope. */
async function runWorkerPhase<T>(page: Page, phase: 'acceptance' | 'calibrate'): Promise<T> {
  return page.evaluate(
    async ({ moduleUrl, manifest, workerPhase }): Promise<T> => {
      const workerModule = (await import(/* @vite-ignore */ moduleUrl)) as {
        readonly default: string;
      };
      const worker = new Worker(workerModule.default, { type: 'module' });
      try {
        return await new Promise<T>((resolve, reject) => {
          worker.addEventListener(
            'message',
            (
              event: MessageEvent<
                | { readonly ok: true; readonly result: T }
                | { readonly ok: false; readonly error: string }
              >,
            ) => {
              if (event.data.ok) resolve(event.data.result);
              else reject(new Error(event.data.error));
            },
            { once: true },
          );
          worker.addEventListener(
            'error',
            (event) => reject(new Error(event.message || 'parallel-drain worker failed')),
            { once: true },
          );
          worker.postMessage({ phase: workerPhase, manifestUrl: manifest });
        });
      } finally {
        worker.terminate();
      }
    },
    { moduleUrl: workerModuleUrl, manifest: manifestUrl, workerPhase: phase },
  );
}

test('durability drain on a real 26k-file node_modules tree beats the same-run serial baseline ≥2.5x (#256 I3)', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await gotoHarness(page);

  const result = await runWorkerPhase<AcceptanceResult>(page, 'acceptance');

  // PR-record line FIRST, before any gate — wall-clock numbers must land in
  // the log even while the ratio gate is RED; only the ratio is asserted.
  console.log(`PD256-ACCEPTANCE: ${JSON.stringify(result)}`);

  // I3 tree-size gate: a real ≥20k-file tree, exactly the manifest's walk.
  expect(result.files).toBeGreaterThanOrEqual(20_000);
  expect(result.files).toBe(result.statsFiles);
  expect(result.totalBytes).toBe(result.statsTotalBytes);
  // Clean flush ledger on BOTH variants.
  expect(result.faithfulReportTotal).toBe(0);
  expect(result.productReportTotal).toBe(0);
  // Fresh-surface WHOLE-TREE durability on BOTH variants: exact path
  // equality with the manifest walk + byte-exact reads of ALL files.
  expect(result.faithfulTreeVerified, result.faithfulTreeMismatch ?? 'tree clean').toBe(true);
  expect(result.faithfulTreeFiles).toBe(result.files);
  expect(result.productTreeVerified, result.productTreeMismatch ?? 'tree clean').toBe(true);
  expect(result.productTreeFiles).toBe(result.files);
  // THE I3 gate — RED on main (serial drain ⇒ ~1.3x), GREEN post-ADR-0358.
  // RAW unrounded ratio (`speedup` is log-only rounding), scaled by the
  // calibrated ceiling of the baseline's per-op-flush inflation.
  expect(result.speedupRaw).toBeGreaterThanOrEqual(2.5 * SERIAL_OVERHEAD_BOUND);
});

test('PD256 calibration (manual, pre-implementation evidence)', async ({ page }) => {
  // Manual evidence tool, NOT a CI gate: measures the faithful baseline's
  // per-op-flush inflation vs the one-final-flush serial regime to seed
  // SERIAL_OVERHEAD_BOUND above. Only meaningful PRE-implementation (on main
  // both regimes drain the serial FIFO; post-ADR-0358 the one-flush variant
  // stops being serial), so it is env-gated and skipped in CI.
  test.skip(!process.env.PD256_CALIBRATE, 'manual calibration harness — see contract Decisions');
  test.setTimeout(600_000);
  await gotoHarness(page);

  const result = await runWorkerPhase<CalibrationResult>(page, 'calibrate');

  console.log(`PD256-CALIBRATION: ${JSON.stringify(result)}`);

  expect(result.files).toBeGreaterThanOrEqual(20_000);
  expect(result.rawRatio).toBeGreaterThan(0);
});
