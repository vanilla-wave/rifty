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
        worker.postMessage({ phase: 'acceptance' });
      });
    } finally {
      worker.terminate();
    }
  }, workerModuleUrl);

  expect(result.fileCount).toBe(3002); // 3000 nested + two nonconsecutive root files
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

interface MidDrainAck {
  readonly phase: 'mid-drain';
  readonly completed: number;
  readonly total: number;
}

interface RetryResult {
  readonly reportTotal: number;
  readonly fileCount: number;
  readonly preRetryFiles: number;
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

  const { ack, retry } = await page.evaluate(
    async ({ moduleUrl, namespace }): Promise<{ ack: MidDrainAck; retry: RetryResult }> => {
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
      const acked = once<MidDrainAck>(victim);
      victim.postMessage({ phase: 'apply-no-flush', ns: namespace });
      // The ack itself is discriminated: it only arrives once SOME writes are
      // durably done and MOST are still pending (0 < completed < total).
      const ack = await acked;
      victim.terminate();

      const fresh = new Worker(workerModule.default, { type: 'module' });
      try {
        const result = once<RetryResult>(fresh);
        fresh.postMessage({ phase: 'verify-retry', ns: namespace });
        return { ack, retry: await result };
      } finally {
        fresh.terminate();
      }
    },
    { moduleUrl: workerModuleUrl, namespace: ns },
  );

  // Kill really landed mid-drain: past the first durable byte, far from done.
  expect(ack.phase).toBe('mid-drain');
  expect(ack.completed).toBeGreaterThan(0);
  expect(ack.completed).toBeLessThan(ack.total);
  // The fresh realm SAW the torn tree before retrying…
  expect(retry.preRetryFiles).toBeGreaterThan(0);
  expect(retry.preRetryFiles).toBeLessThan(retry.fileCount);
  // …and the retry restored it byte-complete with a provably clean drain.
  expect(retry.fileCount).toBe(3002);
  expect(retry.reportTotal).toBe(0);
  expect(retry.verifiedAll).toBe(true);
});
