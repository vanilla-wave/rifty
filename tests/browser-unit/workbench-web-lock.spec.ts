import { type Page, expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const WORKBENCH_LOCK = 'rifty:workbench:v1';

interface LockSnapshot {
  readonly held: readonly { readonly name: string; readonly mode: string }[];
  readonly pending: readonly { readonly name: string; readonly mode: string }[];
}

interface OpenAttempt {
  readonly ok: boolean;
  readonly name: string;
  readonly message: string;
}

async function installWorkbenchHarness(page: Page, namespace?: string): Promise<void> {
  await page.evaluate(async (namespace) => {
    interface Workbench {
      close(): Promise<void>;
    }

    interface WorkbenchHarness {
      open(namespace?: string): Promise<void>;
      close(): Promise<void>;
      workerConstructions(): number;
      boundaryCalls(): { workers: number; locks: number; registrations: number };
    }

    interface HostAssets {
      readonly workers: {
        readonly owner: string;
        readonly kernel: string;
        readonly node: string;
        readonly devServer: string;
        readonly typescript: string;
      };
      readonly wasm: { readonly sqlite: string };
    }

    const NativeWorker = globalThis.Worker;
    let workerConstructions = 0;
    let lockRequests = 0;
    let registrations = 0;
    navigator.locks.request = new Proxy(navigator.locks.request, {
      apply(target, receiver, args) {
        lockRequests += 1;
        return Reflect.apply(target, receiver, args);
      },
    });
    navigator.serviceWorker.register = new Proxy(navigator.serviceWorker.register, {
      apply(target, receiver, args) {
        registrations += 1;
        return Reflect.apply(target, receiver, args);
      },
    });
    globalThis.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        workerConstructions += 1;
        return Reflect.construct(target, args, target) as Worker;
      },
    });

    const [publicEntryModule, hostAssetsModule] = await Promise.all([
      import(/* @vite-ignore */ '/src/browser-unit/workbench-public-entry.ts'),
      import('/src/browser-unit/workbench-vite-host-assets.ts'),
    ]);
    const publicEntry = publicEntryModule as unknown as {
      openWorkbench(options: unknown): Promise<Workbench>;
    };
    const hostAssets = (
      hostAssetsModule as unknown as { readonly workbenchViteHostAssets: HostAssets }
    ).workbenchViteHostAssets;
    const ownerWorkerUrl = new URL(hostAssets.workers.owner, location.href);
    const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
    const ownerWorkerReference = ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length);
    const baseElement = document.createElement('base');
    baseElement.href = ownerWorkerBaseUrl.href;
    document.head.prepend(baseElement);

    let workbench: Workbench | null = null;
    const scope = globalThis as typeof globalThis & { __workbenchLockHarness?: WorkbenchHarness };
    scope.__workbenchLockHarness = Object.freeze({
      async open(selectedNamespace = namespace) {
        if (workbench !== null) throw new Error('Workbench harness is already open');
        workbench = await publicEntry.openWorkbench({
          deployment: {
            workers: { ...hostAssets.workers, owner: ownerWorkerReference },
            serviceWorker: { url: '/sw.js', scope: '/' },
            wasm: hostAssets.wasm,
            previewProbeTimeoutMs: 30_000,
          },
          packageAcquisition: { registryUrl: '/npm-registry' },
          storage: {
            persistence: selectedNamespace === undefined ? 'ephemeral' : 'required',
            ...(selectedNamespace === undefined ? {} : { namespace: selectedNamespace }),
          },
        });
      },
      async close() {
        const admitted = workbench;
        if (admitted === null) return;
        await admitted.close();
        workbench = null;
      },
      workerConstructions: () => workerConstructions,
      boundaryCalls: () => ({ workers: workerConstructions, locks: lockRequests, registrations }),
    });
  }, namespace);
}

function openWorkbench(page: Page, namespace?: string): Promise<void> {
  return page.evaluate(async (namespace) => {
    const harness = (
      globalThis as typeof globalThis & {
        __workbenchLockHarness?: { open(namespace?: string): Promise<void> };
      }
    ).__workbenchLockHarness;
    if (harness === undefined) throw new Error('Workbench lock harness is not installed');
    await harness.open(namespace);
  }, namespace);
}

function closeWorkbench(page: Page): Promise<void> {
  return page.evaluate(async () => {
    const harness = (
      globalThis as typeof globalThis & {
        __workbenchLockHarness?: { close(): Promise<void> };
      }
    ).__workbenchLockHarness;
    await harness?.close();
  });
}

function workerConstructions(page: Page): Promise<number> {
  return page.evaluate(() => {
    const harness = (
      globalThis as typeof globalThis & {
        __workbenchLockHarness?: { workerConstructions(): number };
      }
    ).__workbenchLockHarness;
    if (harness === undefined) throw new Error('Workbench lock harness is not installed');
    return harness.workerConstructions();
  });
}

function attemptOpenWorkbench(page: Page): Promise<OpenAttempt> {
  return page.evaluate(async () => {
    const harness = (
      globalThis as typeof globalThis & {
        __workbenchLockHarness?: { open(): Promise<void> };
      }
    ).__workbenchLockHarness;
    if (harness === undefined) throw new Error('Workbench lock harness is not installed');
    try {
      await harness.open();
      return { ok: true, name: '', message: '' };
    } catch (error) {
      return {
        ok: false,
        name: error instanceof Error ? error.name : '',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function workbenchLockSnapshot(page: Page): Promise<LockSnapshot> {
  return page.evaluate(async (lockName) => {
    const snapshot = await navigator.locks.query();
    const project = (locks: readonly LockInfo[]): readonly { name: string; mode: string }[] =>
      locks.flatMap((lock) =>
        lock.name === lockName && lock.mode !== undefined
          ? [{ name: lockName, mode: lock.mode }]
          : [],
      );
    return { held: project(snapshot.held ?? []), pending: project(snapshot.pending ?? []) };
  }, WORKBENCH_LOCK);
}

test('origin Web Lock excludes a second page and a page crash releases the lease', async ({
  context,
  page: firstPage,
}) => {
  test.setTimeout(180_000);
  const secondPage = await context.newPage();

  try {
    await Promise.all([gotoHarness(firstPage), gotoHarness(secondPage)]);
    await installWorkbenchHarness(firstPage);
    await installWorkbenchHarness(secondPage);

    await openWorkbench(firstPage);
    await expect(workbenchLockSnapshot(secondPage)).resolves.toEqual({
      held: [{ name: WORKBENCH_LOCK, mode: 'exclusive' }],
      pending: [],
    });

    expect(await workerConstructions(secondPage)).toBe(0);
    const contended = await attemptOpenWorkbench(secondPage);
    expect(contended).toEqual({
      ok: false,
      name: 'WorkbenchOriginOccupiedError',
      message: "WorkbenchOriginOccupiedError: another page holds this origin's Workbench",
    });
    expect(await workerConstructions(secondPage)).toBe(0);
    await expect(workbenchLockSnapshot(secondPage)).resolves.toEqual({
      held: [{ name: WORKBENCH_LOCK, mode: 'exclusive' }],
      pending: [],
    });

    // Simulate a crashed/closed tab: the Workbench gets no cooperative close call.
    await firstPage.close();
    await expect
      .poll(() => workbenchLockSnapshot(secondPage), { timeout: 10_000 })
      .toEqual({ held: [], pending: [] });

    await openWorkbench(secondPage);
    expect(await workerConstructions(secondPage)).toBeGreaterThan(0);
    await expect(workbenchLockSnapshot(secondPage)).resolves.toEqual({
      held: [{ name: WORKBENCH_LOCK, mode: 'exclusive' }],
      pending: [],
    });

    await closeWorkbench(secondPage);
    await expect
      .poll(() => workbenchLockSnapshot(secondPage), { timeout: 10_000 })
      .toEqual({ held: [], pending: [] });
  } finally {
    if (!firstPage.isClosed()) {
      await closeWorkbench(firstPage).catch(() => {});
      await firstPage.close();
    }
    if (!secondPage.isClosed()) {
      await closeWorkbench(secondPage).catch(() => {});
      await secondPage.close();
    }
  }
});

test('different storage namespaces still share the origin lease', async ({ context, page }) => {
  const other = await context.newPage();
  try {
    await Promise.all([gotoHarness(page), gotoHarness(other)]);
    await installWorkbenchHarness(page, 'lease-A');
    await installWorkbenchHarness(other, 'lease-B');
    await openWorkbench(page);
    expect(await workerConstructions(other)).toBe(0);
    expect(await attemptOpenWorkbench(other)).toEqual({
      ok: false,
      name: 'WorkbenchOriginOccupiedError',
      message: "WorkbenchOriginOccupiedError: another page holds this origin's Workbench",
    });
    expect(await workerConstructions(other)).toBe(0);
    expect(await workbenchLockSnapshot(other)).toEqual({
      held: [{ name: WORKBENCH_LOCK, mode: 'exclusive' }],
      pending: [],
    });
    await closeWorkbench(page);
    await openWorkbench(other);
    expect(await workerConstructions(other)).toBeGreaterThan(0);
    expect(await workbenchLockSnapshot(other)).toEqual({
      held: [{ name: WORKBENCH_LOCK, mode: 'exclusive' }],
      pending: [],
    });
    await closeWorkbench(other);
    expect(await workbenchLockSnapshot(other)).toEqual({ held: [], pending: [] });
  } finally {
    await closeWorkbench(page).catch(() => {});
    await closeWorkbench(other).catch(() => {});
    await other.close();
  }
});

test('invalid public namespace rejects before native admission effects and permits a valid retry', async ({
  page,
}) => {
  await gotoHarness(page);
  await installWorkbenchHarness(page, 'a/b');
  try {
    const invalid = await attemptOpenWorkbench(page);
    expect.soft(invalid.ok).toBe(false);
    expect
      .soft(
        await page.evaluate(() => {
          const harness = (
            globalThis as typeof globalThis & {
              __workbenchLockHarness?: {
                boundaryCalls(): { workers: number; locks: number; registrations: number };
              };
            }
          ).__workbenchLockHarness;
          if (harness === undefined) throw new Error('Workbench lock harness is not installed');
          return harness.boundaryCalls();
        }),
      )
      .toEqual({ workers: 0, locks: 0, registrations: 0 });
    await closeWorkbench(page);
    await openWorkbench(page, 'valid-after-invalid');
    expect(await workerConstructions(page)).toBeGreaterThan(0);
    await closeWorkbench(page);
    expect(await workbenchLockSnapshot(page)).toEqual({ held: [], pending: [] });
  } finally {
    await closeWorkbench(page);
  }
});
