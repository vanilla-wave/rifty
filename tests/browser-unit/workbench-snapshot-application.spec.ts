import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';
import type { bakeApplicationPackage } from './fixtures/snapshot-application-package.ts';

const workerModuleUrl = `/@fs${process.cwd().replaceAll('\\', '/')}/tests/browser-unit/fixtures/workbench-snapshot-application-worker.ts?worker&url`;
let snapshot: Awaited<ReturnType<typeof bakeApplicationPackage>>;
test.beforeAll(() => {
  snapshot = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./fixtures/snapshot-application-package.ts', import.meta.url)),
      ],
      { encoding: 'utf8', timeout: 30_000 },
    ),
  );
});

for (const scenario of [
  { operation: 'reset', boundary: 'before-close' },
  { operation: 'apply', boundary: 'before-close' },
  { operation: 'apply', boundary: 'after-close' },
] as const) {
  test(`${scenario.operation}: same-ID OPFS kill at catalog ${scenario.boundary}`, async ({
    page,
  }) => {
    await gotoHarness(page);
    const result = await page.evaluate(
      async ({ workerModuleUrl, input }) => {
        const module = (await import(/* @vite-ignore */ workerModuleUrl)) as { default: string };
        interface TreeEntry {
          path: string;
          kind: string;
          bytes?: number[];
        }
        interface Paused {
          boundary: string;
          before: TreeEntry[];
          afterProject: TreeEntry[];
          beforeCatalog: string;
        }
        interface Recovered {
          recovered: TreeEntry[];
          current: TreeEntry[];
          project: TreeEntry[];
          acquisition: unknown;
          requests: string[];
          catalog: string;
          journalPresent: boolean;
        }
        const once = <T>(worker: Worker) =>
          new Promise<T>((resolve, reject) => {
            worker.addEventListener(
              'message',
              (event: MessageEvent<{ ok: true; result: T } | { ok: false; error: string }>) => {
                if (event.data.ok) resolve(event.data.result);
                else reject(new Error(event.data.error));
              },
              { once: true },
            );
            worker.addEventListener('error', (event) => reject(new Error(event.message)), {
              once: true,
            });
          });
        const victim = new Worker(module.default, { type: 'module' });
        let paused: Paused;
        try {
          const reached = once<Paused>(victim);
          victim.postMessage({ ...input, phase: 'victim' });
          paused = await reached;
        } finally {
          victim.terminate();
        }
        // The paused native close cannot race ahead between the acknowledgement and kill.
        const fresh = new Worker(module.default, { type: 'module' });
        try {
          const recovered = once<Recovered>(fresh);
          fresh.postMessage({ ...input, phase: 'verify' });
          return { paused, fresh: await recovered };
        } finally {
          fresh.terminate();
        }
      },
      { workerModuleUrl, input: { ...snapshot, ...scenario } },
    );
    console.log(
      '[snapshot-opfs]',
      JSON.stringify({
        ...scenario,
        acquisition: result.fresh.acquisition,
        requests: result.fresh.requests.length,
        rollbackMatches:
          JSON.stringify(result.fresh.recovered) === JSON.stringify(result.paused.before),
      }),
    );
    expect(result.paused.boundary).toBe(scenario.boundary);
    expect(result.fresh.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing' },
    });
    expect(result.fresh.requests).toEqual([]);
    expect(result.fresh.journalPresent).toBe(false);
    expect(result.fresh.current).toEqual(result.fresh.recovered);
    if (scenario.boundary === 'before-close') {
      expect(result.fresh.recovered).toEqual(result.paused.before);
      expect(result.fresh.catalog).toBe(result.paused.beforeCatalog);
    } else {
      expect(result.fresh.project).toEqual(result.paused.afterProject);
      expect(result.fresh.catalog).not.toBe(result.paused.beforeCatalog);
    }
  });
}
