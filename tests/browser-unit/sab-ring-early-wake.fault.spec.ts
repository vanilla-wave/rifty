import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/sab-ring-early-wake-worker.ts?worker&url`;
const sabRingModuleUrl = `/@fs${workspacePath}/packages/kernel/src/ipc/sab-ring.ts`;

interface WorkerOutcome {
  readonly type: 'done' | 'failed';
  readonly reply?: readonly number[];
  readonly error?: string;
  readonly earlyWakeInjected: boolean;
  readonly waitCalls: number;
}

test('real Chromium Worker re-waits after the captured ok-plus-idle host outcome', async ({
  page,
}) => {
  await gotoHarness(page);
  expect(await page.evaluate(() => globalThis.crossOriginIsolated === true)).toBe(true);

  const outcome = await page.evaluate(
    async ({ ringUrl, workerUrl }): Promise<WorkerOutcome> => {
      const workerAsset = (await import(/* @vite-ignore */ workerUrl)) as {
        readonly default: string;
      };
      const ringModule = (await import(/* @vite-ignore */ ringUrl)) as {
        readonly createSabRing: (options: { readonly payloadCapacity: number }) => {
          readonly sab: SharedArrayBuffer;
          readonly ring: {
            readRequest(): Uint8Array | null;
            writeReply(payload: Uint8Array): void;
          };
        };
      };
      const payloadCapacity = 16;
      const { sab, ring: responder } = ringModule.createSabRing({ payloadCapacity });
      const worker = new Worker(workerAsset.default, { type: 'module' });

      try {
        return await new Promise<WorkerOutcome>((resolve, reject) => {
          let outcome: WorkerOutcome | undefined;
          let responderPublished = false;

          const settle = () => {
            if (!outcome || !responderPublished) return;
            if (outcome.type === 'failed') {
              reject(new Error(outcome.error ?? 'SAB early-wake Worker failed'));
              return;
            }
            resolve(outcome);
          };

          worker.addEventListener(
            'message',
            (event: MessageEvent<WorkerOutcome | { type: 'early-wake' }>) => {
              if (event.data.type === 'early-wake') {
                setTimeout(() => {
                  try {
                    const request = responder.readRequest();
                    if (!request || request.join(',') !== '1,2,3') {
                      throw new Error(`unexpected SAB request: ${request?.join(',') ?? 'none'}`);
                    }
                    responder.writeReply(new Uint8Array([4, 5, 6]));
                    responderPublished = true;
                    settle();
                  } catch (error) {
                    reject(error);
                  }
                }, 25);
                return;
              }
              outcome = event.data;
              settle();
            },
          );
          worker.addEventListener('error', (event) => reject(new Error(event.message)), {
            once: true,
          });
          worker.postMessage({ sab, payloadCapacity });
        });
      } finally {
        worker.terminate();
      }
    },
    { ringUrl: sabRingModuleUrl, workerUrl: workerModuleUrl },
  );

  expect(outcome).toEqual({
    type: 'done',
    reply: [4, 5, 6],
    earlyWakeInjected: true,
    waitCalls: 2,
  });
});
