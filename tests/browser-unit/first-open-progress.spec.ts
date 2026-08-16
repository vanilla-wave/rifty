/**
 * First-open durability-progress acceptance (#256, epic
 * project-open-drain-latency) — DESIGNED RED on main.
 *
 * Drives the REAL `runWorkbenchOwner` composition (fake KernelIpc, real OPFS,
 * plain worker realm — see fixtures/first-open-progress-worker.ts) through a
 * real FIRST project open: ~2 000 inline files / ~200 dirs materialize and
 * drain through real OPFS before `workbench:project-opened`. Every owner→page
 * ipc message is captured in order.
 *
 * DESIGNED RED on main: the first-open drain path is MUTE (progress emitter
 * binds only after createProject), so zero
 * `workbench:durability-progress`-shaped messages arrive → the final
 * `progressCount > 0` assert fails. Every other assert passes on main and
 * pins the carrier's reality (owner boots, open succeeds, tree persisted).
 */
import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/first-open-progress-worker.ts?worker&url`;
const hostAssetsUrl = '/src/browser-unit/workbench-vite-host-assets.ts';

interface IpcMessageRecord {
  readonly seq: number;
  readonly type: string;
  readonly detail?: string;
}

interface ProgressRecord {
  readonly seq: number;
  readonly persisted: number;
  readonly total: number;
}

interface FirstOpenResult {
  readonly messages: readonly IpcMessageRecord[];
  readonly replyKind: string;
  readonly replySeq: number;
  readonly failure: string | null;
  readonly progressCount: number;
  readonly progress: readonly ProgressRecord[];
  readonly vfsDurabilityFrameCount: number;
  readonly fileCount: number;
  readonly dirCount: number;
  readonly persistedProjectFiles: number;
  readonly timings: {
    readonly readyMs: number;
    readonly openMs: number;
    readonly totalMs: number;
  };
}

test('first project open publishes durability progress over owner ipc (#256 — designed RED)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await gotoHarness(page);

  const result = await page.evaluate(
    async ({ moduleUrl, assetsUrl }): Promise<FirstOpenResult> => {
      const assets = (await import(/* @vite-ignore */ assetsUrl)) as {
        readonly workbenchViteHostAssets: {
          readonly workers: {
            readonly kernel: string;
            readonly node: string;
            readonly devServer: string;
          };
          readonly wasm: { readonly sqlite: string };
        };
      };
      const workerModule = (await import(/* @vite-ignore */ moduleUrl)) as {
        readonly default: string;
      };
      const worker = new Worker(workerModule.default, { type: 'module' });
      try {
        return await new Promise<FirstOpenResult>((resolve, reject) => {
          worker.addEventListener(
            'message',
            (
              event: MessageEvent<
                | { readonly ok: true; readonly result: FirstOpenResult }
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
            (event) => reject(new Error(event.message || 'first-open-progress worker failed')),
            { once: true },
          );
          worker.postMessage({
            phase: 'first-open',
            deployment: {
              workers: {
                kernel: assets.workbenchViteHostAssets.workers.kernel,
                node: assets.workbenchViteHostAssets.workers.node,
                devServer: assets.workbenchViteHostAssets.workers.devServer,
              },
              wasm: { sqlite: assets.workbenchViteHostAssets.wasm.sqlite },
            },
          });
        });
      } finally {
        worker.terminate();
      }
    },
    { moduleUrl: workerModuleUrl, assetsUrl: hostAssetsUrl },
  );

  // PR-record line — printed BEFORE the designed-RED assert so the RED run's
  // captured message stream lands in the log too.
  console.log(`FIRSTOPEN256 ${JSON.stringify(result)}`);

  // Real first open against real OPFS (all true on main already).
  expect(result.replyKind).toBe('workbench:project-opened');
  expect(result.failure).toBeNull();
  expect(result.messages[0]?.type).toBe('workbench:owner-ready');
  expect(result.fileCount).toBeGreaterThanOrEqual(2000);
  expect(result.dirCount).toBeGreaterThanOrEqual(200);
  // The materialized tree is readable back from REAL OPFS after the reply.
  expect(result.persistedProjectFiles).toBeGreaterThanOrEqual(result.fileCount);

  // DESIGNED RED on main: the first-open drain is mute — no
  // `workbench:durability-progress`-shaped owner→page message ever arrives.
  expect(result.progressCount).toBeGreaterThan(0);

  // I1 pins (post-fix reality; vacuous until the RED above flips):
  // every drain progress message precedes the open reply.
  for (const snapshot of result.progress) {
    expect(snapshot.seq).toBeLessThan(result.replySeq);
  }
  // `total` is fixed per drain (flush watermark) — a total change starts a new
  // drain's stream; within each stream `persisted` is monotone non-decreasing.
  const segments: ProgressRecord[][] = [];
  for (const snapshot of result.progress) {
    const current = segments[segments.length - 1];
    const last = current?.[current.length - 1];
    if (current === undefined || last === undefined || last.total !== snapshot.total) {
      segments.push([snapshot]);
    } else {
      current.push(snapshot);
    }
  }
  for (const segment of segments) {
    for (let index = 1; index < segment.length; index += 1) {
      const prev = segment[index - 1] as ProgressRecord;
      const next = segment[index] as ProgressRecord;
      expect(next.persisted).toBeGreaterThanOrEqual(prev.persisted);
    }
  }
  // ≥1 MID-DRAIN snapshot (not only terminal), and the final drain terminates
  // clean: persisted === total. Universe durability is pinned separately by
  // the real-OPFS walk (persistedProjectFiles >= fileCount above) — the
  // watermark SIZE is not an I1 clause (write-through settles ops eagerly).
  expect(result.progress.some((snapshot) => snapshot.persisted < snapshot.total)).toBe(true);
  const terminal = result.progress[result.progress.length - 1] as ProgressRecord;
  expect(terminal.persisted).toBe(terminal.total);
});
