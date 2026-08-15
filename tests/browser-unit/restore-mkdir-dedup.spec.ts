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

interface RetryResult {
  readonly reportTotal: number;
  readonly fileCount: number;
  readonly verifiedAll: boolean;
}

test('a worker KILLED mid-drain leaves no lying tree: a fresh realm retries the restore and every byte survives (#256 fault row c)', async ({
  page,
}) => {
  // torn-state × mid-restore realm death, REAL: worker 1 applies the archive
  // and is terminated while its 3000-op serial drain is in flight (in-flight
  // OPFS I/O dies with the realm); worker 2 boots fresh over the torn OPFS,
  // re-runs the SAME restore, and must end with a clean flush ledger and
  // EVERY archive byte readable through a fresh OpfsVfs. Stamp trust is not
  // exercised here — no stamp writer is touched by this unit; pending-stamp
  // boot semantics stay owned by ADR-0187 and the crash-consistency e2e item.
  test.setTimeout(120_000);
  await gotoHarness(page);
  const ns = `/restore-kill-256-${Date.now().toString(36)}`;

  const retry = await page.evaluate(
    async ({ moduleUrl, namespace }): Promise<RetryResult> => {
      const workerModule = (await import(/* @vite-ignore */ moduleUrl)) as {
        readonly default: string;
      };
      const once = <T>(worker: Worker) =>
        new Promise<T>((resolve, reject) => {
          worker.addEventListener(
            'message',
            (
              event: MessageEvent<
                { readonly ok: true; readonly result: T } | { readonly ok: false; error: string }
              >,
            ) => {
              if (event.data.ok) resolve(event.data.result);
              else reject(new Error(event.data.error));
            },
            { once: true },
          );
          worker.addEventListener(
            'error',
            (event) => reject(new Error(event.message || 'restore worker failed')),
            { once: true },
          );
        });

      const victim = new Worker(workerModule.default, { type: 'module' });
      const applied = once<{ applied: true }>(victim);
      victim.postMessage({ phase: 'apply-no-flush', ns: namespace });
      await applied;
      // The serial drain of 3000+ ops takes seconds; terminating now is a
      // guaranteed mid-drain kill with in-flight I/O.
      victim.terminate();

      const fresh = new Worker(workerModule.default, { type: 'module' });
      try {
        const result = once<RetryResult>(fresh);
        fresh.postMessage({ phase: 'verify-retry', ns: namespace });
        return await result;
      } finally {
        fresh.terminate();
      }
    },
    { moduleUrl: workerModuleUrl, namespace: ns },
  );

  expect(retry.fileCount).toBe(3000);
  expect(retry.reportTotal).toBe(0); // the retry's own drain is provably durable
  expect(retry.verifiedAll).toBe(true); // every archive byte, fresh surface
});
