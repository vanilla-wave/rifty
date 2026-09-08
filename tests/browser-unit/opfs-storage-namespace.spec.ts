import { expect, test } from '@playwright/test';
import type { NamespaceRunResult } from './fixtures/opfs-storage-namespace-worker.ts';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/opfs-storage-namespace-worker.ts?worker&url`;

test('paired OPFS install isolates two sequential namespaces from an origin host sentinel (I4)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoHarness(page);

  const observed = await page.evaluate(
    async ({ moduleUrl }): Promise<NamespaceRunResult> => {
      const workerModule = (await import(/* @vite-ignore */ moduleUrl)) as {
        readonly default: string;
      };
      const id = crypto.randomUUID();
      const worker = new Worker(workerModule.default, { type: 'module' });
      try {
        return await new Promise<NamespaceRunResult>((resolve, reject) => {
          worker.addEventListener(
            'message',
            (
              event: MessageEvent<
                | { readonly ok: true; readonly result: NamespaceRunResult }
                | { readonly ok: false; error: string }
              >,
            ) => {
              if (event.data.ok) resolve(event.data.result);
              else reject(new Error(event.data.error));
            },
            { once: true },
          );
          worker.addEventListener(
            'error',
            (event) => reject(new Error(event.message || 'namespace worker failed')),
            { once: true },
          );
          worker.postMessage({
            hostName: `i4-host-${id}.txt`,
            nsA: `i4-a-${id}`,
            nsB: `i4-b-${id}`,
            blockedName: `i4-blocked-${id}`,
          });
        });
      } finally {
        worker.terminate();
      }
    },
    { moduleUrl: workerModuleUrl },
  );

  expect(observed.invalidThrew).toBe(true);
  expect(observed.hostVisibleInA).toBe(false);
  expect(observed.hostVisibleInASync).toBe(false);
  expect(observed.aRootNames.every((name) => !name.startsWith('i4-host-'))).toBe(true);
  expect(observed.projectAtOriginRoot).toBe(false);
  expect(observed.projectUnderA).toBe(true);
  expect(observed.bSeesProject).toBe(false);
  expect(observed.bRootNames).toEqual([]);
  expect(observed.aReopenSeesProject).toBe(true);
  expect(observed.hostBytesUnchanged).toBe(true);
  expect(observed.blockedFailed).toBe(true);
  expect(observed.aUnchangedAfterBlocked).toBe(true);
  expect(observed.originAfterA).toEqual(
    expect.arrayContaining([expect.stringMatching(/^i4-host-/), expect.stringMatching(/^i4-a-/)]),
  );
});
