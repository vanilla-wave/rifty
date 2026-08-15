/**
 * Acceptance (issue #256, epic project-open-drain-latency invariant I3,
 * ADR-0358, item vfs/opfs-parallel-write-through-drain): on a real ≥20k-file
 * node_modules tree (the committed 26 811-file gravity-ui manifest — real
 * paths+sizes, procedural bytes) the durability drain completes ≥2.5x faster
 * than the faithful serial baseline measured in the SAME run, with a clean
 * flush ledger and reload-visible tail bytes on both variants.
 *
 * DESIGNED RED on main: enqueuePending chains every op behind pendingTail —
 * the drain is globally serial — so the deduped product drain lands at only
 * ~1.3x over the faithful baseline (< 2.5). Turns GREEN when ADR-0358's
 * bounded ~16-lane per-path parallel drain lands inside OpfsFsSync. See
 * fixtures/opfs-parallel-drain-worker.ts for the two measured regimes.
 */
import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/opfs-parallel-drain-worker.ts?worker&url`;
const manifestUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/real-tree-manifest.json`;

interface AcceptanceResult {
  readonly files: number;
  readonly totalBytes: number;
  readonly dirCount: number;
  readonly statsFiles: number;
  readonly statsTotalBytes: number;
  readonly faithfulMs: number;
  readonly productMs: number;
  readonly speedup: number;
  readonly faithfulReportTotal: number;
  readonly productReportTotal: number;
  readonly faithfulTailVerified: boolean;
  readonly productTailVerified: boolean;
}

test('durability drain on a real 26k-file node_modules tree beats the same-run serial baseline ≥2.5x (#256 I3)', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await gotoHarness(page);

  const result = await page.evaluate(
    async ({ moduleUrl, manifest }): Promise<AcceptanceResult> => {
      const workerModule = (await import(/* @vite-ignore */ moduleUrl)) as {
        readonly default: string;
      };
      const worker = new Worker(workerModule.default, { type: 'module' });
      try {
        return await new Promise<AcceptanceResult>((resolve, reject) => {
          worker.addEventListener(
            'message',
            (
              event: MessageEvent<
                | { readonly ok: true; readonly result: AcceptanceResult }
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
          worker.postMessage({ phase: 'acceptance', manifestUrl: manifest });
        });
      } finally {
        worker.terminate();
      }
    },
    { moduleUrl: workerModuleUrl, manifest: manifestUrl },
  );

  // PR-record line FIRST, before any gate — wall-clock numbers must land in
  // the log even while the ratio gate is RED; only the ratio is asserted.
  console.log(`PD256-ACCEPTANCE: ${JSON.stringify(result)}`);

  // I3 tree-size gate: a real ≥20k-file tree, exactly the manifest's walk.
  expect(result.files).toBeGreaterThanOrEqual(20_000);
  expect(result.files).toBe(result.statsFiles);
  expect(result.totalBytes).toBe(result.statsTotalBytes);
  // Clean flush ledger + fresh-surface tail durability on BOTH variants.
  expect(result.faithfulReportTotal).toBe(0);
  expect(result.productReportTotal).toBe(0);
  expect(result.faithfulTailVerified).toBe(true);
  expect(result.productTailVerified).toBe(true);
  // THE I3 gate — RED on main (serial drain ⇒ ~1.3x), GREEN post-ADR-0358.
  expect(result.speedup).toBeGreaterThanOrEqual(2.5);
});
