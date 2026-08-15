/**
 * Acceptance (issue #256, epic project-open-drain-latency I2, item
 * playground/restore-mkdir-persist-dedup): a restore through the real
 * applyWorkspaceArchive loop over OpfsFsSync + real OPFS enqueues at most
 * one mkdir persist per directory — never ~one per file — with a clean
 * flush ledger and reload-visible bytes. See
 * fixtures/restore-mkdir-dedup-worker.ts for the counting boundary.
 */
import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/restore-mkdir-dedup-worker.ts?worker&url`;

interface AcceptanceResult {
  readonly fileCount: number;
  readonly dirCount: number;
  readonly mkdirPersistOps: number;
  readonly writeOps: number;
  readonly reportTotal: number;
  readonly tailVerified: boolean;
  readonly applyMs: number;
  readonly flushMs: number;
}

test('restore enqueues at most one mkdir persist per directory, never one per file (#256 I2)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoHarness(page);

  const result = await page.evaluate(async (moduleUrl): Promise<AcceptanceResult> => {
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
          (event) => reject(new Error(event.message || 'mkdir-dedup worker failed')),
          { once: true },
        );
        worker.postMessage({ run: true });
      });
    } finally {
      worker.terminate();
    }
  }, workerModuleUrl);

  expect(result.fileCount).toBe(3000);
  expect(result.writeOps).toBe(result.fileCount);
  // I2: ≤ N + D + O(1) total persist ops ⇔ mkdir ops ≤ D + O(1). Pre-dedup
  // this is ~N + 1 (one persist per mkdirSync call, one call per file).
  expect(result.mkdirPersistOps).toBeLessThanOrEqual(result.dirCount + 2);
  expect(result.mkdirPersistOps).toBeLessThan(result.fileCount);
  expect(result.reportTotal).toBe(0);
  expect(result.tailVerified).toBe(true);
  console.log(
    `[mkdir-dedup] N=${result.fileCount} D=${result.dirCount} mkdirOps=${result.mkdirPersistOps} ` +
      `apply=${result.applyMs}ms flush=${result.flushMs}ms`,
  );
});
