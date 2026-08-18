/**
 * Acceptance (issue #256, epic project-open-drain-latency invariant I1,
 * ADR-0359, item playground/project-open-durability-progress) — DESIGNED RED
 * on main.
 *
 * SEAM DRIVEN: the worker-realm drain owner — `OpfsFsSync.flush({onProgress})`
 * over a REAL 12 000-file restore op stream (committed real-tree-manifest
 * subset, real OPFS I/O) — see fixtures/durability-progress-worker.ts for
 * why the full page-side workbench owner cannot restore a ≥10k tree in this
 * lane. I1's "workbench owner health stream" is carried in two committed
 * hops: this spec proves REAL monotone counts at the drain owner at scale;
 * the workbench-browser-owner unit pin ('publishes owner drain-progress
 * frames as durability-progress health events') proves the page hop onto
 * subscribeHealth.
 *
 * DESIGNED RED on main: OpfsFsSync.flush has no progress observer — zero
 * snapshots arrive — so this fails on `snapshotCount > 0`. Turns GREEN when
 * the ADR-0359 vfs seam lands: ≥1 snapshot DURING the drain (not only
 * terminal), monotone non-decreasing, terminal persisted === total, all
 * counts REAL (total === file+dir op count + the root mkdir).
 */
import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/durability-progress-worker.ts?worker&url`;
const manifestUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/real-tree-manifest.json`;

/** ≥10k for I1; 12k keeps the run inside the lane budget (~45% of the full
 * 26 811-file manifest the parallel-drain spec drains twice). */
const FILE_LIMIT = 12_000;

interface FlushProgressSnapshot {
  readonly persisted: number;
  readonly total: number;
}

interface ProgressAcceptanceResult {
  readonly files: number;
  readonly dirCount: number;
  readonly expectedOps: number;
  readonly snapshotCount: number;
  readonly midDrainSnapshotCount: number;
  readonly monotone: boolean;
  readonly boundsRespected: boolean;
  readonly totalsStable: boolean;
  readonly first: FlushProgressSnapshot | null;
  readonly last: FlushProgressSnapshot | null;
  readonly reportTotal: number;
  readonly flushMs: number;
}

test('durability drain reports real monotone progress counts during a ≥10k-file restore (#256 I1)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await gotoHarness(page);

  const result = await page.evaluate(
    async ({ moduleUrl, manifest, fileLimit }): Promise<ProgressAcceptanceResult> => {
      const workerModule = (await import(/* @vite-ignore */ moduleUrl)) as {
        readonly default: string;
      };
      const worker = new Worker(workerModule.default, { type: 'module' });
      try {
        return await new Promise<ProgressAcceptanceResult>((resolve, reject) => {
          worker.addEventListener(
            'message',
            (
              event: MessageEvent<
                | { readonly ok: true; readonly result: ProgressAcceptanceResult }
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
            (event) => reject(new Error(event.message || 'durability-progress worker failed')),
            { once: true },
          );
          worker.postMessage({ phase: 'acceptance', manifestUrl: manifest, fileLimit });
        });
      } finally {
        worker.terminate();
      }
    },
    { moduleUrl: workerModuleUrl, manifest: manifestUrl, fileLimit: FILE_LIMIT },
  );

  // PR-record line — printed BEFORE the designed-RED assert so the RED run's
  // numbers land in the log too.
  console.log(`PD256-PROGRESS ${JSON.stringify(result)}`);

  // Real ≥10k-file restore universe, drained clean (true on main already).
  expect(result.files).toBeGreaterThanOrEqual(10_000);
  expect(result.expectedOps).toBe(result.files + result.dirCount + 1);
  expect(result.reportTotal).toBe(0);

  // DESIGNED RED on main — the ADR-0359 observer seam does not exist, so no
  // snapshot ever arrives.
  expect(result.snapshotCount).toBeGreaterThan(0);
  // ≥1 snapshot DURING the drain — progress, not only a terminal event.
  expect(result.midDrainSnapshotCount).toBeGreaterThan(0);
  // Monotone non-decreasing, in-bounds, watermark-stable REAL counts.
  expect(result.monotone).toBe(true);
  expect(result.boundsRespected).toBe(true);
  expect(result.totalsStable).toBe(true);
  // Terminal completion: persisted === total === the REAL file+dir op count.
  expect(result.last).toEqual({ persisted: result.expectedOps, total: result.expectedOps });
});
