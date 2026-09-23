import { expect, test } from '@playwright/test';
import asyncCase from '../../tools/node-parity-runner/cases/vm/run-in-this-context-offsets-async.case.ts';
import callSitesCase from '../../tools/node-parity-runner/cases/vm/run-in-this-context-offsets-callsites.case.ts';
import offsetsCase from '../../tools/node-parity-runner/cases/vm/run-in-this-context-offsets.case.ts';
import ownSourceUrlInHookCase from '../../tools/node-parity-runner/cases/vm/run-in-this-context-own-source-url-in-hook.case.ts';
import ownSourceUrlCase from '../../tools/node-parity-runner/cases/vm/run-in-this-context-own-source-url.case.ts';
import { normalise } from '../../tools/node-parity-runner/src/diff.ts';
import { runInNode } from '../../tools/node-parity-runner/src/run-in-node.ts';
import type { ParityCase } from '../../tools/node-parity-runner/src/types.ts';
import { gotoHarness } from './fixtures.ts';

// Unit runtime-js/vm-run-in-this-context-offsets: the SAME parity-case code runs
// in real Node (the oracle, via the parity runner's own Node harness) and in a
// fresh Chromium module-worker realm through rifty's `node:vm`. Chromium starts
// with `Error.prepareStackTrace` undefined and formats stacks natively, so this
// is the only carrier of rifty's default stack rendering and of guest hooks
// called by V8 directly (the Node-host runner goes through Node's callback).

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/vm-script-offsets-worker.ts?worker&url`;

interface WorkerRun {
  readonly ok: boolean;
  readonly baseline: { readonly type: string; readonly own: boolean };
  readonly stdout: string;
  readonly error?: string;
}

const cases: ReadonlyArray<readonly [string, ParityCase]> = [
  ['vm/run-in-this-context-offsets', offsetsCase],
  ['vm/run-in-this-context-offsets-callsites', callSitesCase],
  ['vm/run-in-this-context-offsets-async', asyncCase],
  ['vm/run-in-this-context-own-source-url', ownSourceUrlCase],
  ['vm/run-in-this-context-own-source-url-in-hook', ownSourceUrlInHookCase],
];

for (const [name, parityCase] of cases) {
  test(`${name}: Chromium worker realm matches Node`, async ({ page }) => {
    const nodeStdout = normalise(await runInNode(parityCase));
    expect(nodeStdout.length).toBeGreaterThan(0);

    await gotoHarness(page);
    const run = await page.evaluate(
      async ({ moduleUrl, code }): Promise<WorkerRun> => {
        const workerModule = (await import(/* @vite-ignore */ moduleUrl)) as {
          readonly default: string;
        };
        const worker = new Worker(workerModule.default, { type: 'module' });
        try {
          return await new Promise<WorkerRun>((resolve, reject) => {
            worker.addEventListener('message', (event: MessageEvent<WorkerRun>) =>
              resolve(event.data),
            );
            worker.addEventListener('error', (event) =>
              reject(new Error(event.message || 'vm-script-offsets worker failed')),
            );
            worker.postMessage({ code });
          });
        } finally {
          worker.terminate();
        }
      },
      { moduleUrl: workerModuleUrl, code: parityCase.code },
    );

    // Precondition: the realm is Chromium's own (no prior hook installed).
    expect(run.baseline).toEqual({ type: 'undefined', own: false });
    expect(run.error).toBeUndefined();
    expect(run.ok).toBe(true);
    expect(normalise(run.stdout)).toBe(nodeStdout);
  });
}
