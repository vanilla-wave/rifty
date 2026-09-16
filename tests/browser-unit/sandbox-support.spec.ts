import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import type { SandboxSupportCheckId } from '../../packages/workbench/src/index.ts';
import { buildSupportAssets } from '../../tools/publishing/build-support-assets.mjs';
import { bootOwner, closeOwner, readOwnerFile, writeOwnerFile } from './fixtures.ts';
import { startSupportHost } from './fixtures/sandbox-support-host.ts';

interface Check {
  id: SandboxSupportCheckId;
  status: 'passed' | 'failed' | 'incomplete' | 'not-applicable';
  reason: string;
  error?: { name: string; message: string };
}
interface Report {
  checks: Check[];
  modes: Record<
    'coi' | 'nonCoi',
    {
      composition: string;
      conclusion: 'supported' | 'unsupported' | 'inconclusive';
      required: readonly SandboxSupportCheckId[];
      unmet: readonly SandboxSupportCheckId[];
      limitations: readonly SandboxSupportCheckId[];
    }
  >;
  cleanup: Check;
  limits: string[];
}
interface Options {
  probeBaseUrl: string;
  persistence?: 'required' | 'preferred' | 'ephemeral';
  nonCoiVmEngine?: 'rewrite' | 'quickjs';
  wasm?: boolean;
  timeoutMs?: number;
}
let host: Awaited<ReturnType<typeof startSupportHost>>;
let publishedAssets: string;
test.beforeAll(async ({ baseURL }) => {
  if (!baseURL) throw new Error('Missing Vite upstream');
  // The publishing build's own support step, into a scratch dir: no half-written dist/assets.
  publishedAssets = await mkdtemp(join(tmpdir(), 'rifty-support-assets-'));
  await buildSupportAssets(publishedAssets);
  host = await startSupportHost(baseURL, publishedAssets);
});
test.afterAll(async () => {
  await host.close();
  await rm(publishedAssets, { recursive: true, force: true });
});

async function open(page: Page, variant = 'normal', coi = true) {
  const base = `${host.url}/${coi ? 'coi' : 'non-coi'}/${variant}/`;
  await page.goto(`${base}page`);
  await page.evaluate(async () => {
    const entry = await import('/src/browser-unit/workbench-public-entry.ts');
    (globalThis as typeof globalThis & { supportApi: Record<string, unknown> }).supportApi = entry;
  });
  if (variant === 'locks-denied')
    await page.evaluate(() => {
      navigator.locks.request = () =>
        Promise.reject(new DOMException('test locks', 'SecurityError'));
    });
  return base;
}

async function check(page: Page, options: Options): Promise<Report> {
  // Missing API is an explicit behavior assertion, not a module-load RED.
  expect(
    await page.evaluate(
      () =>
        typeof (
          globalThis as typeof globalThis & {
            supportApi: Record<string, unknown>;
          }
        ).supportApi.checkSandboxSupport,
    ),
  ).toBe('function');
  const report = await page.evaluate(async (options) => {
    const api = (
      globalThis as typeof globalThis & {
        supportApi: { checkSandboxSupport(options: Options): Promise<Report> };
      }
    ).supportApi;
    return api.checkSandboxSupport(options);
  }, options);
  for (const mode of Object.values(report.modes)) {
    expect(mode).not.toHaveProperty('reasons');
    for (const ids of [mode.unmet, mode.limitations]) {
      expect(Array.isArray(ids)).toBe(true);
      for (const id of ids)
        expect(report.checks.filter((check) => check.id === id)).toHaveLength(1);
    }
  }
  return report;
}
const storageNames = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const name of root.keys()) names.push(name);
    return names;
  });
const row = (report: Report, id: string) => {
  const found = report.checks.find((check) => check.id === id);
  expect(found, id).toBeDefined();
  if (!found) throw new Error(`Missing ${id}`);
  expect(found.reason.length).toBeGreaterThan(0);
  return found;
};

for (const coi of [true, false]) {
  test(`real ${coi ? 'COI' : 'non-COI'} prerequisites, owner OPFS, cleanup and evidence limits`, async ({
    page,
    browser,
  }) => {
    const probeBaseUrl = await open(page, 'normal', coi);
    const report = await check(page, { probeBaseUrl, persistence: 'required' });
    expect(report.modes.coi.conclusion).toBe(coi ? 'supported' : 'unsupported');
    expect(report.modes.nonCoi.conclusion).toBe('supported');
    expect(report.modes.nonCoi.unmet).toEqual([]);
    expect(report.modes.coi.unmet).toEqual(coi ? [] : ['cross-origin-isolated', 'shared-memory']);
    for (const id of [
      'module-worker',
      'module-import',
      'nested-worker',
      'message-port',
      'broadcast-channel',
      'js-eval',
      'wasm',
      'page-locks',
      'opfs',
      'service-worker-registration',
    ]) {
      expect(row(report, id).status, id).toBe('passed');
    }
    expect(row(report, 'deployment-control').status).toBe('incomplete');
    expect(report.modes.coi.required).not.toContain('deployment-control');
    expect(report.cleanup.status).toBe('passed');
    expect(report.limits.join(' ')).toMatch(/deployment/i);
    expect(report.limits.join(' ')).toMatch(/package/i);
    const leftovers = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names: string[] = [];
      for await (const name of root.keys()) names.push(name);
      return {
        names,
        registrations: (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope),
      };
    });
    expect(leftovers).toEqual({ names: [], registrations: [] });
    console.log(`[sandbox-support] Chromium/${browser.version()} ${JSON.stringify(report)}`);
  });
}

test('[fault: corrupt-input] missing probe configuration throws before any probe starts', async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const api = (
      globalThis as typeof globalThis & {
        supportApi: { checkSandboxSupport(options?: Partial<Options>): Promise<Report> };
      }
    ).supportApi;
    let observations = 0;
    const secure = isSecureContext;
    Object.defineProperty(globalThis, 'isSecureContext', {
      configurable: true,
      get: () => {
        observations++;
        return secure;
      },
    });
    const outcomes = [];
    for (const options of [undefined, {}, { probeBaseUrl: undefined }]) {
      try {
        await api.checkSandboxSupport(options);
        outcomes.push({ name: 'resolved', message: '' });
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        outcomes.push({ name: error.name, message: error.message });
      }
    }
    return { outcomes, observations };
  });
  expect(result.outcomes).toEqual(
    Array.from({ length: 3 }, () => ({
      name: 'TypeError',
      message: expect.stringContaining('probeBaseUrl'),
    })),
  );
  expect(result.observations).toBe(0);
});

test('published probe assets perform real browser operations', async ({ page }) => {
  const probeBaseUrl = await open(page, 'published');
  const report = await check(page, { probeBaseUrl, persistence: 'required' });
  expect(report.modes.coi.conclusion, JSON.stringify(report)).toBe('supported');
  expect(report.modes.nonCoi.conclusion).toBe('supported');
  expect(row(report, 'module-import').status).toBe('passed');
  expect(row(report, 'nested-worker').status).toBe('passed');
  expect(report.cleanup.status).toBe('passed');
});

for (const [variant, failed] of [
  ['worker-denied', 'module-worker'],
  ['nested-denied', 'nested-worker'],
  ['import-denied', 'module-import'],
  ['wasm-only', 'js-eval'],
  ['locks-denied', 'page-locks'],
] as const) {
  test(`[fault: provenance-lie] actual ${variant} cannot give positive required verdict`, async ({
    page,
  }) => {
    const probeBaseUrl = await open(page, variant);
    const report = await check(page, { probeBaseUrl });
    expect(row(report, failed).status).toBe('failed');
    expect(report.modes.coi.conclusion).toBe('unsupported');
    if (variant !== 'locks-denied' && variant !== 'nested-denied')
      expect(report.modes.nonCoi.conclusion).toBe('unsupported');
    if (variant === 'wasm-only') expect(row(report, 'wasm').status).toBe('passed');
    if (variant === 'nested-denied') expect(row(report, 'module-worker').status).toBe('passed');
    if (variant === 'worker-denied') {
      expect(row(report, failed).reason).toMatch(/unknown|SecurityError/i);
    }
  });
}

test('[fault: false-fallback] SW registration denial differs from presence and non-COI admission', async ({
  page,
}) => {
  const probeBaseUrl = await open(page, 'sw-denied');
  const report = await check(page, { probeBaseUrl });
  expect(row(report, 'service-worker-api').status).toBe('passed');
  expect(row(report, 'service-worker-registration').status).toBe('failed');
  expect(report.modes.coi.conclusion).toBe('unsupported');
  expect(report.modes.nonCoi.conclusion).toBe('supported');
  expect(report.modes.nonCoi.limitations).toEqual(['service-worker-module-registration']);
});

for (const variant of ['storage-denied', 'quota']) {
  test(`[fault: quota-perm-fail] ${variant}: required, preferred, ephemeral`, async ({ page }) => {
    const probeBaseUrl = await open(page, variant, false);
    const required = await check(page, { probeBaseUrl, persistence: 'required' });
    expect(row(required, 'opfs').status).toBe('failed');
    expect(row(required, 'opfs').error?.name).toBe(
      variant === 'quota' ? 'QuotaExceededError' : 'NotAllowedError',
    );
    expect(required.modes.nonCoi.conclusion).toBe('unsupported');
    const preferred = await check(page, { probeBaseUrl, persistence: 'preferred' });
    expect(preferred.modes.nonCoi.conclusion).toBe('supported');
    expect(preferred.modes.nonCoi.limitations).toEqual(['opfs']);
    const ephemeral = await check(page, { probeBaseUrl, persistence: 'ephemeral' });
    expect(row(ephemeral, 'opfs').status).toBe('not-applicable');
    expect(ephemeral.modes.nonCoi.conclusion).toBe('supported');
    expect(required.cleanup.status).toBe('passed');
  });
}

for (const variant of ['dead', 'stalled']) {
  test(`[fault: unbounded-read] ${variant} Worker settles with honest missing evidence`, async ({
    page,
  }) => {
    const probeBaseUrl = await open(page, variant);
    const started = Date.now();
    const report = await check(page, { probeBaseUrl, timeoutMs: 600 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(report.modes.coi.conclusion).not.toBe('supported');
    expect(report.modes.nonCoi.conclusion).not.toBe('supported');
    expect(row(report, 'module-worker').status).toBe(variant === 'dead' ? 'failed' : 'incomplete');
    expect(report.cleanup.status).toBe('passed');
  });
}

test('[fault: concurrent-same-key] same/other-page probes preserve native files, sessions and registrations', async ({
  page,
  context,
}) => {
  const probeBaseUrl = await open(page);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle('existing-project', { create: true });
    const writer = await file.createWritable();
    await writer.write('project bytes');
    await writer.close();
    await navigator.serviceWorker.register('/existing-sw.js', { scope: '/' });
    const scope = globalThis as typeof globalThis & { releaseSupportLease?: () => void };
    await new Promise<void>((resolve) => {
      void navigator.locks.request(
        'rifty:workbench:v1',
        () =>
          new Promise<void>((release) => {
            scope.releaseSupportLease = release;
            resolve();
          }),
      );
    });
  });
  const before = await page.evaluate(async () => ({
    registrations: (await navigator.serviceWorker.getRegistrations()).map((r) => ({
      scope: r.scope,
      script: (r.active ?? r.installing ?? r.waiting)?.scriptURL,
    })),
    controller: navigator.serviceWorker.controller?.scriptURL ?? null,
  }));
  const other = await context.newPage();
  await open(other);
  try {
    const reports = await Promise.all([
      check(page, { probeBaseUrl }),
      check(page, { probeBaseUrl }),
      check(other, { probeBaseUrl }),
    ]);
    expect(
      reports.every((r) => r.modes.coi.conclusion === 'supported' && r.cleanup.status === 'passed'),
      JSON.stringify(reports),
    ).toBe(true);
    const after = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names: string[] = [];
      for await (const name of root.keys()) names.push(name);
      return {
        names,
        bytes: await (await (await root.getFileHandle('existing-project')).getFile()).text(),
        registrations: (await navigator.serviceWorker.getRegistrations()).map((r) => ({
          scope: r.scope,
          script: (r.active ?? r.installing ?? r.waiting)?.scriptURL,
        })),
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        locks: (await navigator.locks.query()).held?.map((l) => l.name),
      };
    });
    expect(after).toEqual({
      ...before,
      names: ['existing-project'],
      bytes: 'project bytes',
      locks: ['rifty:workbench:v1'],
    });
  } finally {
    await other.close();
  }
});

test('[fault: poisoned-cache] repeated call observes new denial', async ({ page }) => {
  const probeBaseUrl = await open(page);
  expect((await check(page, { probeBaseUrl })).modes.coi.conclusion).toBe('supported');
  const denied = await check(page, { probeBaseUrl: `${host.url}/coi/sw-denied/` });
  expect(denied.modes.coi.conclusion).toBe('unsupported');
});

test('[fault: quota-perm-fail] cleanup rejection stays explicit and preserves foreign entries', async ({
  page,
}) => {
  const probeBaseUrl = await open(page);
  await page.evaluate(() => {
    FileSystemDirectoryHandle.prototype.removeEntry = () =>
      Promise.reject(new DOMException('cleanup denied', 'NotAllowedError'));
  });
  const report = await check(page, { probeBaseUrl });
  expect(report.cleanup.status).toBe('failed');
  expect(report.cleanup.reason).toMatch(/cleanup|denied/i);
});

test('WASM requiredness follows VM/workload selection independently of JS eval', async ({
  page,
}) => {
  const probeBaseUrl = await open(page);
  const rewrite = await check(page, { probeBaseUrl, nonCoiVmEngine: 'rewrite' });
  const quickjs = await check(page, { probeBaseUrl, nonCoiVmEngine: 'quickjs' });
  const wasm = await check(page, { probeBaseUrl, wasm: true });
  expect(rewrite.modes.nonCoi.required).not.toContain('wasm');
  expect(quickjs.modes.nonCoi.required).toContain('wasm');
  expect(wasm.modes.nonCoi.required).toContain('wasm');
  expect(quickjs.modes.nonCoi.required).toContain('js-eval');
});

test('[fault: unbounded-read] late native registration retains cleanup after timeout', async ({
  page,
}) => {
  const probeBaseUrl = await open(page);
  await page.evaluate(() => {
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = async (...args) => {
      const registration = await register(...args);
      await new Promise((resolve) => setTimeout(resolve, 1800));
      return registration;
    };
  });
  const report = await check(page, { probeBaseUrl, timeoutMs: 300 });
  expect(row(report, 'service-worker-registration').status).toBe('incomplete');
  expect(report.cleanup.status).toBe('incomplete');
  await expect
    .poll(
      () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
      { timeout: 7000 },
    )
    .toBe(0);
});

test('[fault: concurrent-same-key] deadline inside the OPFS phase still removes the held scratch', async ({
  page,
}) => {
  const probeBaseUrl = await open(page, 'storage-slow');
  const report = await check(page, { probeBaseUrl, persistence: 'required', timeoutMs: 300 });
  expect(row(report, 'opfs').status).toBe('incomplete');
  // A Worker still holding its own sync access handle is teardown order, not a cleanup verdict.
  expect(report.cleanup.status, report.cleanup.reason).not.toBe('failed');
  await expect.poll(() => storageNames(page), { timeout: 7000 }).toEqual([]);
});

test('[fault: provenance-lie] a late Worker failure cannot unprove the observed module load', async ({
  page,
}) => {
  const probeBaseUrl = await open(page, 'late-error');
  const report = await check(page, { probeBaseUrl, persistence: 'required' });
  expect(row(report, 'module-worker').status).toBe('passed');
  expect(row(report, 'opfs').status).toBe('incomplete');
  expect(row(report, 'opfs').reason).toMatch(/late probe worker failure/i);
  expect(report.modes.nonCoi.conclusion).toBe('inconclusive');
});

test('[fault: unbounded-read] cleanup stall is bounded and incomplete', async ({ page }) => {
  const probeBaseUrl = await open(page);
  await page.evaluate(() => {
    FileSystemDirectoryHandle.prototype.removeEntry = () => new Promise(() => {});
  });
  const started = Date.now();
  const report = await check(page, { probeBaseUrl, timeoutMs: 600 });
  expect(Date.now() - started).toBeLessThan(5000);
  expect(report.cleanup.status).toBe('incomplete');
});

test('[fault: concurrent-same-key] pre-existing probe-shaped entry is never adopted or deleted', async ({
  page,
}) => {
  const probeBaseUrl = await open(page);
  await page.evaluate(async () => {
    crypto.randomUUID = () => '11111111-1111-4111-8111-111111111111';
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(
      'rifty-support-11111111-1111-4111-8111-111111111111',
      { create: true },
    );
    const writer = await (await dir.getFileHandle('keep', { create: true })).createWritable();
    await writer.write('untouched');
    await writer.close();
  });
  const report = await check(page, { probeBaseUrl, persistence: 'required' });
  expect(row(report, 'opfs').status).toBe('incomplete');
  expect(
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(
        'rifty-support-11111111-1111-4111-8111-111111111111',
      );
      return (await (await dir.getFileHandle('keep')).getFile()).text();
    }),
  ).toBe('untouched');
});

test('[fault: provenance-lie] missing native Atomics waitAsync blocks only COI', async ({
  page,
}) => {
  const probeBaseUrl = await open(page);
  await page.evaluate(() => {
    Object.defineProperty(Atomics, 'waitAsync', { value: undefined, configurable: true });
  });
  const report = await check(page, { probeBaseUrl });
  expect(row(report, 'shared-memory').status).toBe('failed');
  expect(report.modes.coi.conclusion).toBe('unsupported');
  expect(report.modes.nonCoi.conclusion).toBe('supported');
});

test('legacy SDK detector remains synchronous passive presence', async ({ page }) => {
  await open(page, 'worker-denied');
  const moduleUrl = `/@fs${process.cwd()}/packages/rifty/src/capabilities.ts`;
  const passive = await page.evaluate(async (moduleUrl) => {
    const { checkCapabilities } = await import(/* @vite-ignore */ moduleUrl);
    const report = checkCapabilities();
    return { sufficient: report.sufficient, promise: report instanceof Promise };
  }, moduleUrl);
  expect(passive).toEqual({ sufficient: true, promise: false });
});

test('[fault: concurrent-same-key] real active Workbench project survives same/other-tab probes', async ({
  page,
  context,
}) => {
  const probeBaseUrl = await open(page);
  await check(page, { probeBaseUrl });
  await bootOwner(page, {
    workspaceId: 'support-live-project',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  const other = await context.newPage();
  try {
    await writeOwnerFile(page, '/scratch/support-live.txt', 'live project bytes');
    await open(other);
    const reports = await Promise.all([
      check(page, { probeBaseUrl }),
      check(other, { probeBaseUrl }),
    ]);
    expect(
      reports.every((r) => r.modes.coi.conclusion === 'supported'),
      JSON.stringify(reports),
    ).toBe(true);
    expect(await readOwnerFile(page, '/scratch/support-live.txt')).toEqual({
      ok: true,
      text: 'live project bytes',
      error: '',
    });
    await writeOwnerFile(page, '/scratch/support-after.txt', 'owner still alive');
    expect(await readOwnerFile(page, '/scratch/support-after.txt')).toEqual({
      ok: true,
      text: 'owner still alive',
      error: '',
    });
  } finally {
    await closeOwner(page);
    await other.close();
  }
});

test('[fault: unbounded-read] late native scratch creation cannot escape cleanup', async ({
  page,
}) => {
  const probeBaseUrl = await open(page);
  await page.evaluate(() => {
    const getDirectory = FileSystemDirectoryHandle.prototype.getDirectoryHandle;
    FileSystemDirectoryHandle.prototype.getDirectoryHandle = async function (name, options) {
      const handle = await getDirectory.call(this, name, options);
      if (options?.create && name.startsWith('rifty-support-'))
        await new Promise((resolve) => setTimeout(resolve, 1800));
      return handle;
    };
  });
  const report = await check(page, { probeBaseUrl, persistence: 'required', timeoutMs: 300 });
  expect(row(report, 'opfs').status).toBe('incomplete');
  expect(report.cleanup.status).toBe('incomplete');
  await expect.poll(() => storageNames(page), { timeout: 7000 }).toEqual([]);
});

test('[fault: false-fallback] WASM denial follows selected engine and workload', async ({
  page,
}) => {
  const probeBaseUrl = await open(page, 'wasm-denied');
  const rewrite = await check(page, { probeBaseUrl });
  expect(row(rewrite, 'wasm').status).toBe('failed');
  expect(rewrite.modes.coi.conclusion).toBe('unsupported');
  expect(rewrite.modes.nonCoi.conclusion).toBe('supported');
  const quickjs = await check(page, { probeBaseUrl, nonCoiVmEngine: 'quickjs' });
  expect(quickjs.modes.nonCoi.conclusion).toBe('unsupported');
  const workload = await check(page, { probeBaseUrl, wasm: true });
  expect(workload.modes.nonCoi.conclusion).toBe('unsupported');
});

test('[fault: provenance-lie] unavailable BroadcastChannel cannot prove preview prerequisites', async ({
  page,
}) => {
  const probeBaseUrl = await open(page);
  await page.evaluate(() => {
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true });
  });
  const report = await check(page, { probeBaseUrl });
  expect(row(report, 'broadcast-channel').status).toBe('failed');
  expect(report.modes.coi.conclusion).toBe('unsupported');
  expect(report.modes.nonCoi.limitations).toContain('broadcast-channel');
});

test('[fault: provenance-lie] unavailable UUID is an established failure for both compositions', async ({
  page,
}) => {
  const probeBaseUrl = await open(page);
  await page.evaluate(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  const report = await check(page, { probeBaseUrl });
  expect(row(report, 'crypto').status).toBe('failed');
  expect(report.modes.coi.conclusion).toBe('unsupported');
  expect(report.modes.nonCoi.conclusion).toBe('unsupported');
  expect(report.modes.nonCoi.unmet).toContain('crypto');
});

test('[fault: concurrent-same-key] private lock collision is inconclusive, never browser incompatibility', async ({
  page,
}) => {
  const probeBaseUrl = await open(page);
  await page.evaluate(async () => {
    crypto.randomUUID = () => '22222222-2222-4222-8222-222222222222';
    await new Promise<void>((resolve) => {
      void navigator.locks.request(
        'rifty-support-22222222-2222-4222-8222-222222222222',
        () =>
          new Promise<void>((release) => {
            (
              globalThis as typeof globalThis & { releasePrivateLock: () => void }
            ).releasePrivateLock = release;
            resolve();
          }),
      );
    });
  });
  try {
    const report = await check(page, { probeBaseUrl, persistence: 'ephemeral' });
    expect(row(report, 'page-locks').status).toBe('incomplete');
    expect(report.modes.coi.conclusion).toBe('inconclusive');
  } finally {
    await page.evaluate(() =>
      (globalThis as typeof globalThis & { releasePrivateLock: () => void }).releasePrivateLock(),
    );
  }
});
