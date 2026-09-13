import { type Page, expect, test } from '@playwright/test';
const clientUrl = `/@fs${process.cwd()}/tests/browser-unit/fixtures/legacy-layout-workbench.ts`;
const oldPath = '/.rifty/workbench/v1/projects/scratch/tree/old-edit.txt';
async function seed(page: Page, namespace?: string) {
  await page.evaluate(
    async ({ namespace, path }) => {
      let root = await navigator.storage.getDirectory();
      if (namespace !== undefined)
        root = await root.getDirectoryHandle(namespace, { create: true });
      const mount = root;
      for (const name of path.split('/').slice(1, -1))
        root = await root.getDirectoryHandle(name, { create: true });
      const file = await root.getFileHandle('old-edit.txt', { create: true });
      const writer = await file.createWritable();
      await writer.write('old private edit');
      await writer.close();
      const catalog = {
        version: 1,
        active: { kind: 'project', id: 'old-project' },
        scratch: {
          starterId: 'lost-starter',
          dirty: true,
          editedAt: '2026-09-01T00:00:00.000Z',
          adoption: {
            kind: 'adopted',
            definitionIdentity: 'old-definition',
            baselineFingerprint: 'old-baseline',
          },
        },
        projects: [
          {
            id: 'old-project',
            name: 'Saved before format switch',
            starterId: 'lost-starter',
            editedAt: '2026-09-01T00:00:00.000Z',
            adoption: {
              kind: 'adopted',
              definitionIdentity: 'old-definition',
              baselineFingerprint: 'old-baseline',
            },
          },
        ],
      };
      let catalogRoot = mount;
      for (const part of ['.rifty', 'workbench', 'v1', 'playground'])
        catalogRoot = await catalogRoot.getDirectoryHandle(part, { create: true });
      const catalogWriter = await (
        await catalogRoot.getFileHandle('catalog.json', { create: true })
      ).createWritable();
      await catalogWriter.write(JSON.stringify(catalog));
      await catalogWriter.close();
    },
    { namespace, path: oldPath },
  );
}
async function oldBytes(page: Page, namespace?: string) {
  return page.evaluate(
    async ({ namespace, path }) => {
      let root = await navigator.storage.getDirectory();
      if (namespace !== undefined) root = await root.getDirectoryHandle(namespace);
      for (const name of path.split('/').slice(1, -1)) root = await root.getDirectoryHandle(name);
      return (await (await root.getFileHandle('old-edit.txt')).getFile()).text();
    },
    { namespace, path: oldPath },
  );
}
async function boot(page: Page, namespace?: string) {
  return page.evaluate(
    async ({ url, namespace }) => (await import(/* @vite-ignore */ url)).boot(namespace),
    { url: clientUrl, namespace },
  );
}
async function close(page: Page) {
  await page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).close(), clientUrl);
}
for (const namespace of [undefined, 'legacy-selected'])
  test(`legacy notice and definition-only restore under ${namespace ?? 'default'} root`, async ({
    page,
  }) => {
    await page.goto('/unit-harness.html');
    await seed(page, namespace);
    const first = await boot(page, namespace);
    expect(first.catalog.projects).toEqual([]);
    expect(first.catalog.scratch).toBeNull();
    expect(first.health.issues).toContainEqual({
      kind: 'degraded',
      scope: 'storage-layout',
      recovery: 'none',
      summary: expect.stringMatching(/legacy per-file OPFS v1/),
    });
    expect(await oldBytes(page, namespace)).toBe('old private edit');
    // A proof-only owner has not completed the transition; page death cannot mark notice seen.
    await page.reload();
    const repeated = await boot(page, namespace);
    expect(repeated.health.issues).toEqual(first.health.issues);
    const materialized = await page.evaluate(
      async (url) => (await import(/* @vite-ignore */ url)).materialize(),
      clientUrl,
    );
    expect(materialized.source).toBe('new definition');
    expect(materialized.oldExists).toBe(false);
    expect(materialized.health.issues).toEqual(first.health.issues);
    await close(page);
    await page.reload();
    const restored = await boot(page, namespace);
    expect(
      restored.health.issues.filter((issue: { scope: string }) => issue.scope === 'storage-layout'),
    ).toEqual([]);
    expect(await oldBytes(page, namespace)).toBe('old private edit');
    await close(page);
  });
test('legacy outside the selected namespace and ephemeral policy do not create a notice', async ({
  page,
}) => {
  await page.goto('/unit-harness.html');
  await seed(page, 'outside');
  expect((await boot(page, 'clean')).health.issues).toEqual([]);
  await close(page);
  const ephemeral = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).boot('outside', undefined, 'ephemeral'),
    clientUrl,
  );
  expect(ephemeral.health.issues).toEqual([]);
  await close(page);
  expect(await oldBytes(page, 'outside')).toBe('old private edit');
});

for (const mode of ['proof-before', 'proof-after'])
  test(`corruption diagnosis survives death at first ${mode} HEAD`, async ({ page }) => {
    const { corruptHead, startFault } = await import('./fixtures/legacy-layout-faults.ts');
    await page.goto('/unit-harness.html');
    await corruptHead(page, 'corrupt-proof');
    expect(await startFault(page, 'corrupt-proof', mode)).toEqual({ ok: true, error: mode });
    await page.reload();
    const restored = await boot(page, 'corrupt-proof');
    expect(restored.health.issues).toContainEqual({
      kind: 'degraded',
      scope: 'storage-layout',
      recovery: 'none',
      summary: expect.stringMatching(/corrupt/i),
    });
    expect(JSON.stringify(restored.health)).not.toContain('invalid HEAD sentinel');
    await close(page);
  });
test('diagnosis quota cannot publish a clean owner without its corruption notice', async ({
  page,
}) => {
  const { corruptHead, startFault } = await import('./fixtures/legacy-layout-faults.ts');
  await page.goto('/unit-harness.html');
  await corruptHead(page, 'corrupt-quota');
  const result = await startFault(page, 'corrupt-quota', 'marker-quota');
  expect(result.ok).toBe(false);
  expect('denied' in result ? result.denied : []).toContain('marker-quota');
  await page.reload();
  const restored = await boot(page, 'corrupt-quota');
  expect(
    restored.health.issues.some((issue: { scope: string }) => issue.scope === 'storage-layout'),
  ).toBe(true);
  await close(page);
});
for (const mode of ['stage-before', 'stage-quota'])
  test(`legacy ${mode} preserves old bytes and repeats diagnosis`, async ({ page }) => {
    const { startFault } = await import('./fixtures/legacy-layout-faults.ts');
    await page.goto('/unit-harness.html');
    await seed(page, 'legacy-stage');
    const result = await startFault(page, 'legacy-stage', mode, true);
    expect(result.ok, result.error).toBe(mode === 'stage-before');
    if (mode === 'stage-before') expect(result.error).toBe(mode);
    await page.reload();
    expect(await oldBytes(page, 'legacy-stage')).toBe('old private edit');
    const restored = await boot(page, 'legacy-stage');
    expect(
      restored.health.issues.some((issue: { scope: string }) => issue.scope === 'storage-layout'),
    ).toBe(true);
    expect(
      (
        await page.evaluate(
          async (url) => (await import(/* @vite-ignore */ url)).materialize(),
          clientUrl,
        )
      ).source,
    ).toBe('new definition');
    await close(page);
  });

test('real health banner has no false recovery and retains notice across project generations', async ({
  page,
}) => {
  await page.goto('/unit-harness.html');
  await seed(page, 'legacy-health');
  await boot(page, 'legacy-health');
  const result = await page.evaluate(
    async ({ url, banner }) => {
      const client = await import(/* @vite-ignore */ url);
      const states: unknown[] = [];
      const stop = client.health().subscribe((snapshot: unknown) => states.push(snapshot));
      await (await import(/* @vite-ignore */ banner)).mount();
      await client.materialize();
      await client.closeProject();
      await client.materialize();
      stop();
      const late: unknown[] = [];
      client.health().subscribe((snapshot: unknown) => late.push(snapshot))();
      return { states, late, after: client.inspect().health };
    },
    {
      url: clientUrl,
      banner: `/@fs${process.cwd()}/tests/browser-unit/fixtures/legacy-layout-banner.tsx`,
    },
  );
  expect(result.after.issues).toContainEqual({
    kind: 'degraded',
    scope: 'storage-layout',
    recovery: 'none',
    summary: expect.stringMatching(/legacy per-file OPFS v1/),
  });
  expect(
    result.states.every((state: unknown) =>
      (state as { issues: { scope: string }[] }).issues.some(
        (issue) => issue.scope === 'storage-layout',
      ),
    ),
  ).toBe(true);
  expect(result.late).toEqual([result.after]);
  await expect(page.locator('[data-health-scope="storage-layout"]')).toContainText(
    'legacy per-file OPFS v1',
  );
  await expect(page.locator('[data-health-scope="storage-layout"] button')).toHaveCount(0);
  await close(page);
});
test('malformed current orphan cannot suppress legacy notice or prevent a valid sibling from completing restoration', async ({
  page,
}) => {
  const { accessNativeReplica, encoded } = await import('./fixtures/opfs-storage-namespace.ts');
  await page.goto('/unit-harness.html');
  await seed(page, 'legacy-orphan');
  await accessNativeReplica(page, {
    namespace: 'legacy-orphan',
    files: {
      '/.rifty/workbench/v2/projects/!invalid/definition.json': encoded('invalid metadata'),
      '/.rifty/workbench/v2/projects/!invalid/tree/note.txt': encoded('orphan retained'),
    },
  });
  expect(
    (await boot(page, 'legacy-orphan')).health.issues.some(
      (issue: { scope: string }) => issue.scope === 'storage-layout',
    ),
  ).toBe(true);
  await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).materialize(),
    clientUrl,
  );
  await close(page);
  await page.reload();
  expect(
    (await boot(page, 'legacy-orphan')).health.issues.filter(
      (issue: { scope: string }) => issue.scope === 'storage-layout',
    ),
  ).toEqual([]);
  await close(page);
  expect(
    await accessNativeReplica(page, {
      namespace: 'legacy-orphan',
      paths: ['/.rifty/workbench/v2/projects/!invalid/tree/note.txt'],
    }),
  ).toEqual({ '/.rifty/workbench/v2/projects/!invalid/tree/note.txt': encoded('orphan retained') });
});

test('preferred proof fallback retains the captured corruption diagnosis', async ({ page }) => {
  const { corruptHead, startFault } = await import('./fixtures/legacy-layout-faults.ts');
  await page.goto('/unit-harness.html');
  await corruptHead(page, 'corrupt-preferred');
  const result = await startFault(page, 'corrupt-preferred', 'marker-quota', false, 'preferred');
  expect(result.ok).toBe(true);
  expect('denied' in result ? result.denied : []).toContain('marker-quota');
  const opened = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).inspect(),
    clientUrl,
  );
  expect(opened.storage.backend).toBe('memory');
  expect(opened.health.issues).toContainEqual({
    kind: 'degraded',
    scope: 'storage-layout',
    recovery: 'none',
    summary: expect.stringMatching(/corrupt/i),
  });
  await close(page);
});

test('plain Workbench checks actual project records and skips malformed native candidates', async ({
  page,
}) => {
  const { accessNativeReplica, encoded } = await import('./fixtures/opfs-storage-namespace.ts');
  await page.goto('/unit-harness.html');
  await seed(page, 'plain-orphans');
  const malformed = '/.rifty/workbench/v2/projects/broken/definition.json';
  await accessNativeReplica(page, {
    namespace: 'plain-orphans',
    files: {
      [malformed]: encoded('invalid metadata'),
      '/.rifty/workbench/v2/projects/!invalid/tree/file': encoded('invalid key'),
    },
    directories: [
      '/.rifty/workbench/v2/projects/broken/tree',
      '/.rifty/workbench/v2/projects/incomplete',
    ],
  });
  const before = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).bootPlain('plain-orphans'),
    clientUrl,
  );
  expect(before.issues.some((issue: { scope: string }) => issue.scope === 'storage-layout')).toBe(
    true,
  );
  await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).closePlain(),
    clientUrl,
  );
  await page.evaluate(async (url) => {
    const worker = new Worker(url, { type: 'module' });
    try {
      await new Promise<void>((resolve, reject) => {
        worker.onmessage = ({ data }) => (data.ok ? resolve() : reject(new Error(data.error)));
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage({ namespace: 'plain-orphans' });
      });
    } finally {
      worker.terminate();
    }
  }, `/@fs${process.cwd()}/tests/browser-unit/fixtures/legacy-layout-valid-project-worker.ts`);
  const after = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).bootPlain('plain-orphans'),
    clientUrl,
  );
  expect(
    after.issues.filter((issue: { scope: string }) => issue.scope === 'storage-layout'),
  ).toEqual([]);
  await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).closePlain(),
    clientUrl,
  );
  expect(
    await accessNativeReplica(page, { namespace: 'plain-orphans', paths: [malformed] }),
  ).toEqual({ [malformed]: encoded('invalid metadata') });
});
