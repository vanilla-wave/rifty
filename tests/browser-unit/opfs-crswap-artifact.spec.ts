/**
 * `.crswap` artifacts never leak through the rifty OPFS read surface
 * (fault: torn-state × Storage (OPFS); born as a CI flake of
 * opfs-parallel-drain-kill.spec.ts — run 31942415727 saw
 * "unexpected: …/f001.js.crswap" through PRODUCTION `OpfsVfs.readdir`).
 *
 * Chromium's `createWritable()` swaps bytes in through a sibling
 * `<name>.crswap` temp; a realm killed before `close()` orphans it and the
 * raw directory iterator lists it like a real file. Honest surface: after a
 * crash-reload a Node program sees the target entry (complete, or the empty
 * created-not-swapped torn state) — never the platform's mid-op artifact,
 * which no program ever created. Probed platform fact (recorded, not
 * assumed): Chromium ALLOWS user files named `*.crswap`, so the filter is
 * honest only paired with a loud create-side reservation (EINVAL) — else it
 * would silently hide real user data.
 *
 * RED on main: both read surfaces (`OpfsVfs.readdir`, booted
 * `OpfsFsSync` index) report `victim.js.crswap`, and every rifty create op
 * accepts the reserved name.
 */
import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/opfs-crswap-artifact-worker.ts?worker&url`;

interface ObserveResult {
  readonly rawEntries: readonly string[];
  readonly platformCrswapCreate: string;
  readonly vfsReaddir: readonly string[];
  readonly syncReaddir: readonly string[];
  readonly syncCrswapExists: boolean;
  readonly completeBytesOk: boolean;
  readonly victimEmptyVisible: boolean;
  readonly reserveVfsWrite: string;
  readonly reserveVfsMkdir: string;
  readonly reserveSyncWrite: string;
  readonly reserveSyncMkdir: string;
  readonly reserveSyncRename: string;
}

test("a killed writer's .crswap temp is invisible to the rifty OPFS surface (torn-state, kill-spec flake root cause)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoHarness(page);

  // The artifact's visible window is ANY in-flight `createWritable` — the
  // sibling `.crswap` is a real directory entry until close()'s swap (and an
  // orphan when the realm dies first, the CI birth). Observing while the
  // victim HOLDS the writable open makes the window deterministic; the same
  // read-surface filter covers the orphan case by construction.
  const observed = await page.evaluate(
    async ({ moduleUrl }): Promise<ObserveResult> => {
      const workerModule = (await import(/* @vite-ignore */ moduleUrl)) as {
        readonly default: string;
      };
      const call = <T>(worker: Worker, message: object) =>
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
            (event) => reject(new Error(event.message || 'crswap worker failed')),
            { once: true },
          );
          worker.postMessage(message);
        });

      const ns = `/crswap-${Date.now()}`;
      const victim = new Worker(workerModule.default, { type: 'module' });
      try {
        await call(victim, { phase: 'leak', ns });
        const observer = new Worker(workerModule.default, { type: 'module' });
        try {
          return await call<ObserveResult>(observer, { phase: 'observe', ns });
        } finally {
          observer.terminate();
        }
      } finally {
        victim.terminate();
        const cleaner = new Worker(workerModule.default, { type: 'module' });
        await call(cleaner, { phase: 'cleanup', ns }).catch(() => {});
        cleaner.terminate();
      }
    },
    { moduleUrl: workerModuleUrl },
  );

  console.log(`CRSWAP256 ${JSON.stringify(observed)}`);

  // Precondition — the artifact is really present at the RAW layer while the
  // victim's writable is open (otherwise this run proved nothing).
  expect(observed.rawEntries.filter((name) => name.endsWith('.crswap'))).toEqual([
    'victim.js.crswap',
  ]);

  // RED on main — the artifact must be invisible to BOTH read surfaces.
  expect(observed.vfsReaddir).not.toContain('victim.js.crswap');
  expect(observed.syncReaddir).not.toContain('victim.js.crswap');
  expect(observed.syncCrswapExists).toBe(false);

  // RED on main — reservation: the platform ALLOWS user `*.crswap` files
  // (platformCrswapCreate above stays a recorded fact, not an assumption),
  // so the filter is honest only if every rifty create op refuses loudly.
  expect(observed.reserveVfsWrite).toBe('EINVAL');
  expect(observed.reserveVfsMkdir).toBe('EINVAL');
  expect(observed.reserveSyncWrite).toBe('EINVAL');
  expect(observed.reserveSyncMkdir).toBe('EINVAL');
  expect(observed.reserveSyncRename).toBe('EINVAL');

  // Torn model preserved: the complete control file is byte-exact and the
  // victim's created-not-swapped EMPTY entry stays visible on both surfaces.
  expect(observed.completeBytesOk).toBe(true);
  expect(observed.victimEmptyVisible).toBe(true);
});
