import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/opfs-persist-watchdog-worker.ts?worker&url`;

interface AcceptanceResult {
  readonly fileCount: number;
  readonly flushMs: number;
  readonly maxWriteMs: number;
  readonly persistedTail: readonly number[];
  readonly reportTotal: number;
  readonly watchdogMs: number;
  readonly watchdogTimers: number;
  readonly writes: number;
}

test('real OPFS FIFO may outlive its watchdog budget without timing out queued writes', async ({
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
          (event) => reject(new Error(event.message || 'OPFS watchdog Worker failed')),
          { once: true },
        );
        worker.postMessage({ run: true });
      });
    } finally {
      worker.terminate();
    }
  }, workerModuleUrl);

  expect(result.fileCount).toBe(12_000);
  expect(result.writes).toBe(result.fileCount);
  expect(result.flushMs).toBeGreaterThan(result.watchdogMs);
  expect(result.maxWriteMs).toBeLessThan(result.watchdogMs);
  expect(result.watchdogTimers).toBe(result.writes);
  expect(result.reportTotal).toBe(0);
  expect(result.persistedTail).toEqual([0x24, 0x70, 0x47, 0xff]);
});
