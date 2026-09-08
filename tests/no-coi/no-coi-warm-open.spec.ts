import { type Page, expect, test } from '@playwright/test';

const workspace = process.cwd().replaceAll('\\', '/');
const pageFixtureUrl = `/@fs${workspace}/tests/no-coi/fixtures/no-coi-warm-open-page.ts`;
const workerFixtureUrl = `/@fs${workspace}/tests/no-coi/fixtures/no-coi-warm-open-worker.ts`;
const root = '/warm-project';
const stamp = `${root}/node_modules/.rifty-install-stamp.json`;

async function invoke<T = unknown>(
  page: Page,
  method: string,
  args: readonly unknown[] = [],
): Promise<T> {
  return page.evaluate(
    async ({ url, method, args }) => {
      const fixture = await import(/* @vite-ignore */ url);
      const action = Reflect.get(fixture, method) as (...values: readonly unknown[]) => Promise<T>;
      return action(...args);
    },
    { url: pageFixtureUrl, method, args },
  );
}
async function boot(page: Page): Promise<void> {
  const response = await page.goto('/no-coi-harness.html');
  expect(response?.headers()['cross-origin-opener-policy']).toBeUndefined();
  expect(response?.headers()['cross-origin-embedder-policy']).toBeUndefined();
  expect(await invoke(page, 'boot', [workerFixtureUrl])).toEqual({
    coi: false,
    openType: 'function',
  });
}
async function reopen(page: Page): Promise<void> {
  await invoke(page, 'dispose');
  await boot(page); // A navigation destroys the old page and its activation snapshot.
}
async function seed(page: Page, vite = false): Promise<void> {
  const files: Record<string, string> = {
    '/package.json': JSON.stringify({
      name: 'warm-open-fixture',
      version: '1.0.0',
      type: 'module',
      dependencies: { nanoid: '3.3.18', ...(vite ? { vite: '7.3.6' } : {}) },
    }),
    '/source.txt': 'saved source',
  };
  if (vite)
    Object.assign(files, {
      '/index.html': '<!doctype html><script type="module" src="/main.js"></script>\n',
      '/main.js': 'document.body.textContent = "warm-open-build-marker";\n',
      '/vite.config.js': 'export default { build: { minify: false, sourcemap: false } };\n',
    });
  for (const [path, text] of Object.entries(files))
    await invoke(page, 'write', [`${root}${path}`, text]);
}

/** Inspect persisted bytes independently of the runtime mirror/activation authority. */
async function durableTree(page: Page): Promise<readonly { path: string; sha256: string }[]> {
  return page.evaluate(async (root) => {
    let handle = await navigator.storage.getDirectory();
    for (const part of root.slice(1).split('/')) handle = await handle.getDirectoryHandle(part);
    const result: Array<{ path: string; sha256: string }> = [];
    const walk = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, entry] of directory.entries()) {
        if (entry.kind === 'directory')
          await walk(entry as FileSystemDirectoryHandle, `${prefix}/${name}`);
        else {
          const bytes = await (await (entry as FileSystemFileHandle).getFile()).arrayBuffer();
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
          result.push({
            path: `${prefix}/${name}`,
            sha256: [...digest].map((n) => n.toString(16).padStart(2, '0')).join(''),
          });
        }
      }
    };
    await walk(handle, root);
    return result.toSorted((a, b) => a.path.localeCompare(b.path));
  }, root);
}

async function replaceNative(page: Page, path: string, text: string | null): Promise<void> {
  await page.evaluate(
    async ({ path, text }) => {
      const parts = path.slice(1).split('/');
      const name = parts.pop();
      if (name === undefined) throw new Error('native test path missing basename');
      let directory = await navigator.storage.getDirectory();
      for (const part of parts) directory = await directory.getDirectoryHandle(part);
      if (text === null) await directory.removeEntry(name);
      else {
        const writer = await (
          await directory.getFileHandle(name, { create: true })
        ).createWritable();
        await writer.write(text);
        await writer.close();
      }
    },
    { path, text },
  );
}

async function rejectedOpen(
  page: Page,
  registryUrl = '/npm-registry',
): Promise<{ name: string; message: string }> {
  try {
    await invoke(page, 'open', [root, registryUrl]);
    return { name: 'resolved', message: '' };
  } catch (error) {
    const inspected = error as Error;
    return { name: inspected.name, message: inspected.message };
  }
}

test('full page warm-open activates Vite and preserves dependency edits until explicit cached repair', async ({
  page,
  context,
  browser,
}) => {
  console.log(`[warm-open] Chromium/${browser.version()}`);
  let registryRequests = 0;
  context.on('request', (request) => {
    if (request.url().includes('/npm-registry')) registryRequests++;
  });
  await boot(page);
  await seed(page, true);
  await invoke(page, 'install', [root]);
  expect(await invoke(page, 'build', [root])).toMatchObject({
    exitCode: 0,
    output: expect.stringContaining('built in'),
  });
  const beforeReopen = await durableTree(page);
  await reopen(page);
  const counters = await invoke(page, 'counts');
  const requests = registryRequests;
  await invoke(page, 'open', [root]);
  expect(await invoke(page, 'counts')).toEqual(counters);
  expect(registryRequests).toBe(requests);
  expect(await durableTree(page)).toEqual(beforeReopen);
  expect(await invoke(page, 'build', [root])).toMatchObject({ exitCode: 0 });

  const editedPath = `${root}/node_modules/nanoid/non-secure/index.cjs`;
  const deletedPath = `${root}/node_modules/nanoid/index.cjs`;
  const original = await invoke<string>(page, 'read', [editedPath]);
  const deleted = await invoke<string>(page, 'read', [deletedPath]);
  const marker = 'module.exports = { nanoid: () => "saved-edit" };';
  expect(original.length).toBeGreaterThan(marker.length);
  const edited = marker.padEnd(original.length, ' ');
  await invoke(page, 'write', [editedPath, edited]);
  await invoke(page, 'write', [`${root}/node_modules/nanoid/extra.txt`, 'saved extra']);
  await invoke(page, 'write', [`${root}/source.txt`, 'source edit']);
  await invoke(page, 'dispose');
  await replaceNative(page, deletedPath, null);
  await boot(page);
  const editedTree = await durableTree(page);
  const editedCounters = await invoke(page, 'counts');
  const editedRequests = registryRequests;
  await invoke(page, 'open', [root]);
  expect(await invoke(page, 'counts')).toEqual(editedCounters);
  expect(registryRequests).toBe(editedRequests);
  expect(await durableTree(page)).toEqual(editedTree);
  expect(await invoke(page, 'read', [editedPath])).toBe(edited);
  expect(await invoke(page, 'read', [deletedPath])).toBeNull();
  expect(await invoke(page, 'read', [`${root}/node_modules/nanoid/extra.txt`])).toBe('saved extra');
  expect(await invoke(page, 'read', [`${root}/source.txt`])).toBe('source edit');
  expect(
    await invoke(page, 'evaluate', [
      `console.log(require(${JSON.stringify(editedPath)}).nanoid())`,
    ]),
  ).toContain('saved-edit');
  expect(
    await invoke(page, 'evaluate', [
      `try { require(${JSON.stringify(deletedPath)}); console.log('unexpected-success'); } catch (error) { console.log('missing:' + error.code); }`,
    ]),
  ).toContain('missing:MODULE_NOT_FOUND');
  const repairRequests = registryRequests;
  await invoke(page, 'install', [root]);
  expect(registryRequests).toBe(repairRequests);
  expect(await invoke(page, 'read', [editedPath])).toBe(original);
  expect(await invoke(page, 'read', [deletedPath])).toBe(deleted);
  expect(await invoke(page, 'read', [`${root}/source.txt`])).toBe('source edit');
  expect(await invoke(page, 'build', [root])).toMatchObject({ exitCode: 0 });
  await invoke(page, 'dispose');
});

for (const drift of [
  'missing',
  'pending',
  'legacy',
  'policy',
  'root',
  'manifest',
  'lock',
  'registry',
] as const) {
  test(`warm-open refuses ${drift} installation authority without altering saved bytes`, async ({
    page,
    context,
  }) => {
    let registryRequests = 0;
    context.on('request', (request) => {
      if (request.url().includes('/npm-registry')) registryRequests++;
    });
    await boot(page);
    await seed(page);
    await invoke(page, 'install', [root]);
    const stampText = await invoke<string>(page, 'read', [stamp]);
    const claim = JSON.parse(stampText) as Record<string, unknown>;
    await invoke(page, 'dispose');
    if (drift === 'missing') await replaceNative(page, stamp, null);
    if (drift === 'pending')
      await replaceNative(
        page,
        stamp,
        JSON.stringify({ ...claim, durability: 'pending', epoch: 'interrupted-install' }),
      );
    if (drift === 'legacy')
      await replaceNative(page, stamp, JSON.stringify({ ...claim, version: 3 }));
    if (drift === 'policy')
      await replaceNative(
        page,
        stamp,
        JSON.stringify({ ...claim, installArtifactIdentity: `sha256:${'0'.repeat(64)}` }),
      );
    if (drift === 'root')
      await replaceNative(page, stamp, JSON.stringify({ ...claim, root: '/copied-project' }));
    if (drift === 'manifest')
      await replaceNative(
        page,
        `${root}/package.json`,
        `${JSON.stringify({ name: 'changed', dependencies: { nanoid: '3.3.18' } })}\n`,
      );
    if (drift === 'lock')
      await replaceNative(page, `${root}/package-lock.json`, '{"lockfileVersion":3,"packages":{}}');
    await boot(page);
    const before = await durableTree(page);
    const counts = await invoke(page, 'counts');
    const requests = registryRequests;
    const failure = await rejectedOpen(
      page,
      drift === 'registry' ? '/different-registry' : '/npm-registry',
    );
    expect(failure.name).not.toBe('resolved');
    expect(failure.message).toMatch(/install/i);
    expect(await durableTree(page)).toEqual(before);
    expect(await invoke(page, 'counts')).toEqual(counts);
    expect(registryRequests).toBe(requests);
    await invoke(page, 'dispose');
  });
}

for (const failedFile of ['package-lock.json', '.rifty-install-stamp.json'] as const) {
  test(`failed native ${failedFile} persistence cannot authorize warm-open`, async ({ page }) => {
    await boot(page);
    await seed(page);
    await invoke(page, 'counts', [failedFile]);
    await expect(invoke(page, 'install', [root])).rejects.toThrow(
      /warm-open native quota probe|persist|durab/i,
    );
    expect(await invoke(page, 'counts')).toMatchObject({ failures: expect.any(Number) });
    const counts = await invoke<{ failures: number }>(page, 'counts');
    expect(counts.failures).toBeGreaterThan(0);
    await reopen(page);
    const before = await durableTree(page);
    expect((await rejectedOpen(page)).name).not.toBe('resolved');
    expect(await durableTree(page)).toEqual(before);
    await invoke(page, 'dispose');
  });
}

test('public fs and guest copy cannot manufacture reserved installation authority', async ({
  page,
}) => {
  await boot(page);
  await seed(page);
  await invoke(page, 'install', [root]);
  const text = await invoke<string>(page, 'read', [stamp]);
  const before = await durableTree(page);
  await expect(invoke(page, 'write', [stamp, text])).rejects.toThrow(/reserved|EPERM|claim/i);
  expect(
    await invoke(page, 'evaluate', [
      `
    try { require('node:fs').copyFileSync(${JSON.stringify(stamp)}, ${JSON.stringify(`${root}/copied-claim.json`)}); console.log('unexpected-success'); }
    catch (error) { console.log('claim-rejected:' + error.code); }
  `,
    ]),
  ).toContain('claim-rejected:');
  expect(
    await invoke(page, 'evaluate', [
      `
    try { require('node:fs').renameSync(${JSON.stringify(`${root}/node_modules`)}, ${JSON.stringify(`${root}/moved-tree`)}); console.log('unexpected-success'); }
    catch (error) { console.log('claim-rejected:' + error.code); }
  `,
    ]),
  ).toContain('claim-rejected:');
  expect(await durableTree(page)).toEqual(before);
  await invoke(page, 'dispose');
});
