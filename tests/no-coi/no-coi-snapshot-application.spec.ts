import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import type { bakeApplicationPackage } from '../browser-unit/fixtures/snapshot-application-package.ts';

const root = process.cwd().replaceAll('\\', '/');
const fixture = `/@fs${root}/tests/no-coi/fixtures/no-coi-snapshot-page.ts`;
const productionWorker = `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`;
let first: Awaited<ReturnType<typeof bakeApplicationPackage>>;
let updated: typeof first;
let nativeMsOutput: string;
test.beforeAll(() => {
  const bake = (version: string, msVersion = '2.0.0') =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(
            new URL('../browser-unit/fixtures/snapshot-application-package.ts', import.meta.url),
          ),
          version,
          msVersion,
        ],
        { encoding: 'utf8', timeout: 30_000 },
      ),
    );
  first = bake('1.0.0');
  updated = bake('1.0.1', '2.1.3');
  const native = mkdtempSync(join(tmpdir(), 'rifty-sdk-ms-reference-'));
  try {
    execFileSync('tar', [
      '-xzf',
      fileURLToPath(new URL('../integration/fixtures/registry/ms-2.0.0.tgz', import.meta.url)),
      '-C',
      native,
    ]);
    nativeMsOutput = execFileSync(
      process.execPath,
      [
        '-e',
        `process.stdout.write(String(require(${JSON.stringify(join(native, 'package'))})('2 days')) + '\\n')`,
      ],
      { encoding: 'utf8' },
    );
    console.log(`[snapshot-reference] ${process.version}: ${nativeMsOutput.trim()}`);
  } finally {
    rmSync(native, { recursive: true, force: true });
  }
});

function descriptor(snapshot = first, assetUrl = '/snapshot.tar.gz') {
  return { assetUrl, snapshotId: snapshot.snapshotId, templateId: 'opfs-ms' };
}

test('snapshot application retains resident operation admission', async ({ page, context }) => {
  let fetches = 0;
  context.on('request', (request) => {
    if (new URL(request.url()).pathname === '/snapshot.tar.gz') fetches++;
  });
  await serve(context);
  await boot(page);
  await invoke(page, 'write', ['/project/source.txt', 'unchanged']);
  await invoke(page, 'startLocalServer');
  await expect(invoke(page, 'apply', [descriptor(), true])).rejects.toThrow(/resident-concurrency/);
  expect(fetches).toBe(0);
  await invoke(page, 'dispose');
});
async function invoke<T = unknown>(
  page: Page,
  method: string,
  args: readonly unknown[] = [],
): Promise<T> {
  return page.evaluate(
    async ({ fixture, method, args }) => {
      const module = await import(/* @vite-ignore */ fixture);
      return Reflect.get(module, method)(...args);
    },
    { fixture, method, args },
  );
}
async function boot(page: Page, worker = productionWorker) {
  await page.goto('/no-coi-harness.html');
  expect(await invoke(page, 'boot', [worker])).toEqual({ coi: false, applyType: 'function' });
}
async function serve(context: BrowserContext, snapshot = first) {
  await context.route('**/snapshot.tar.gz', (route) =>
    route.fulfill({
      contentType: 'application/gzip',
      body: Buffer.from(snapshot.archive),
    }),
  );
}
async function tree(page: Page) {
  return page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('sdk-snapshot');
    const entries: { path: string; sha256: string }[] = [];
    const walk = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of directory.entries()) {
        const path = `${prefix}/${name}`;
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, path);
        else {
          const bytes = await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer();
          entries.push({
            path,
            sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
              .map((n) => n.toString(16).padStart(2, '0'))
              .join(''),
          });
        }
      }
    };
    await walk(root, '');
    return entries.toSorted((a, b) => a.path.localeCompare(b.path));
  });
}
async function nativeReplace(page: Page, path: string, directory: boolean) {
  await page.evaluate(
    async ({ path, directory }) => {
      let root = await (await navigator.storage.getDirectory()).getDirectoryHandle('sdk-snapshot');
      const parts = path.slice(1).split('/');
      const name = parts.pop();
      if (!name) throw new Error('missing basename');
      for (const part of parts) root = await root.getDirectoryHandle(part);
      await root.removeEntry(name, { recursive: true });
      if (directory) {
        const target = await root.getDirectoryHandle(name, { create: true });
        const writer = await (
          await target.getFileHandle('descendant.txt', { create: true })
        ).createWritable();
        await writer.write('overwritten target descendant');
        await writer.close();
      }
    },
    { path, directory },
  );
}

test('producer application, saved edits, same-ID conflicts/force and explicit changed artifact', async ({
  page,
  context,
}) => {
  const network: string[] = [];
  context.on('request', (request) => {
    if (/\/npm-registry(?:\/|$)|\/eddy(?:\/|$)|registry\.npmjs\.org/.test(request.url()))
      network.push(request.url());
  });
  await serve(context);
  await boot(page);
  await invoke(page, 'write', ['/project/source.txt', 'source survives']);
  await invoke(page, 'apply', [descriptor()]);
  const appliedTree = await tree(page);
  await context.unroute('**/snapshot.tar.gz');
  await context.route('**/snapshot.tar.gz', (route) =>
    route.fulfill({ body: 'corrupted same-ID source' }),
  );
  await expect(invoke(page, 'apply', [descriptor(), true])).rejects.toThrow(/snapshot.*mismatch/i);
  expect(await tree(page)).toEqual(appliedTree);
  await context.unroute('**/snapshot.tar.gz');
  await serve(context);
  const result = await invoke(page, 'evaluate', [
    "console.log(require('/project/node_modules/ms')('2 days'));void 0",
  ]);
  expect(result).toMatchObject({ result: { ok: true }, output: nativeMsOutput });
  await invoke(page, 'write', [
    '/project/node_modules/ms/index.js',
    'module.exports = () => "saved edit";',
  ]);
  await invoke(page, 'write', ['/project/node_modules/ms/extra.txt', 'extra survives']);
  await invoke(page, 'dispose');
  await boot(page);
  const saved = await tree(page);
  await invoke(page, 'open');
  expect(await tree(page)).toEqual(saved);
  expect(
    await invoke(page, 'evaluate', ["console.log(require('/project/node_modules/ms')());void 0"]),
  ).toMatchObject({ result: { ok: true }, output: 'saved edit\n' });
  await expect(invoke(page, 'apply', [descriptor()])).rejects.toThrow(/conflict/i);
  expect(await tree(page)).toEqual(saved);
  await invoke(page, 'apply', [descriptor(), true]);
  expect(await invoke(page, 'read', ['/project/source.txt'])).toBe('source survives');
  expect(await invoke(page, 'read', ['/project/node_modules/ms/extra.txt'])).toBe('extra survives');
  await invoke(page, 'dispose');
  await nativeReplace(page, '/project/node_modules/ms/index.js', true);
  await boot(page);
  const directoryTarget = await tree(page);
  await expect(invoke(page, 'apply', [descriptor()])).rejects.toThrow(/conflict/i);
  expect(await tree(page)).toEqual(directoryTarget);
  await invoke(page, 'apply', [descriptor(), true]);
  await expect(
    invoke(page, 'read', ['/project/node_modules/ms/index.js/descendant.txt']),
  ).rejects.toThrow();
  expect(first.snapshotId).not.toBe(updated.snapshotId);
  await context.unroute('**/snapshot.tar.gz');
  await serve(context, updated);
  const beforeUpdate = await tree(page);
  await expect(invoke(page, 'apply', [descriptor(updated)])).rejects.toThrow(/conflict/i);
  expect(await tree(page)).toEqual(beforeUpdate);
  await invoke(page, 'apply', [descriptor(updated), true]);
  expect(JSON.parse(await invoke<string>(page, 'read', ['/project/package.json'])).version).toBe(
    '1.0.1',
  );
  expect(await invoke(page, 'read', ['/project/source.txt'])).toBe('source survives');
  expect(
    JSON.parse(await invoke<string>(page, 'read', ['/project/node_modules/ms/package.json']))
      .version,
  ).toBe('2.1.3');
  expect(network).toEqual([]);
  await invoke(page, 'dispose');
});

for (const fault of [
  'missing',
  'corrupt',
  'wrong-id',
  'wrong-template',
  'oversized',
  'incompatible-runtime',
  'malformed-envelope',
] as const) {
  test(`required ${fault} input fails without writes or acquisition fallback, also with force`, async ({
    page,
    context,
  }) => {
    const requests: string[] = [];
    context.on('request', (request) => {
      if (/\/npm-registry(?:\/|$)|\/eddy(?:\/|$)|registry\.npmjs\.org/.test(request.url()))
        requests.push(request.url());
    });
    await context.route('**/snapshot.tar.gz', (route) =>
      route.fulfill({
        status: fault === 'missing' ? 404 : 200,
        headers: fault === 'oversized' ? { 'content-length': String(129 * 1024 * 1024) } : {},
        body:
          fault === 'corrupt'
            ? Buffer.from([0, 1, 2])
            : Buffer.from(
                fault === 'incompatible-runtime'
                  ? first.incompatible.archive
                  : fault === 'malformed-envelope'
                    ? first.malformed.archive
                    : first.archive,
              ),
      }),
    );
    await boot(page);
    await invoke(page, 'write', ['/project/source.txt', 'untouched']);
    const before = await tree(page);
    const input = {
      ...descriptor(),
      ...(fault === 'incompatible-runtime'
        ? { snapshotId: first.incompatible.snapshotId }
        : fault === 'malformed-envelope'
          ? { snapshotId: first.malformed.snapshotId }
          : {}),
      ...(fault === 'wrong-id' ? { snapshotId: `sha256:${'0'.repeat(64)}` } : {}),
      ...(fault === 'wrong-template' ? { templateId: 'different' } : {}),
    };
    await expect(invoke(page, 'apply', [input, true])).rejects.toThrow(
      /snapshot|HTTP|bytes|mismatch|template/i,
    );
    expect(await tree(page)).toEqual(before);
    expect(requests).toEqual([]);
    await invoke(page, 'dispose');
  });
}

test('native persistence failure rejects application but ordinary source access remains', async ({
  page,
  context,
}) => {
  await serve(context);
  await boot(page, `/@fs${root}/tests/no-coi/fixtures/no-coi-snapshot-fault-worker.ts?fault=quota`);
  await invoke(page, 'write', ['/project/source.txt', 'independent source']);
  await expect(invoke(page, 'apply', [descriptor()])).rejects.toThrow(/persist|quota/i);
  await invoke(page, 'open');
  expect(
    await invoke(page, 'evaluate', [
      "console.log(require('node:fs').readFileSync('/project/source.txt','utf8'));void 0",
    ]),
  ).toMatchObject({ result: { ok: true }, output: 'independent source\n' });
  await invoke(page, 'dispose');
  await boot(page);
  await invoke(page, 'open');
  expect(await invoke(page, 'read', ['/project/source.txt'])).toBe('independent source');
  await invoke(page, 'apply', [descriptor(), true]);
  await invoke(page, 'dispose');
});

test('tab death during native application leaves readable source; explicit reapply recovers dependency', async ({
  page,
  context,
}) => {
  await serve(context);
  await boot(page, `/@fs${root}/tests/no-coi/fixtures/no-coi-snapshot-fault-worker.ts?fault=hold`);
  await invoke(page, 'write', ['/project/source.txt', 'survives interrupted apply']);
  await invoke(page, 'beginApply', [descriptor()]);
  await expect
    .poll(() => invoke(page, 'state'))
    .toEqual({ held: true, applicationState: 'pending' });
  await expect(invoke(page, 'apply', [descriptor(), true])).rejects.toThrow(/already active/);
  await page.close();
  const reopened = await context.newPage();
  await boot(reopened);
  await invoke(reopened, 'open');
  expect(
    await invoke(reopened, 'evaluate', [
      "console.log(require('node:fs').readFileSync('/project/source.txt','utf8'));void 0",
    ]),
  ).toMatchObject({ result: { ok: true }, output: 'survives interrupted apply\n' });
  expect(
    await invoke(reopened, 'evaluate', ["require('/project/node_modules/ms')('2 days')"]),
  ).toMatchObject({ result: { ok: false } });
  await invoke(reopened, 'apply', [descriptor(), true]);
  await invoke(reopened, 'dispose');
  await boot(reopened);
  await invoke(reopened, 'open');
  expect(
    await invoke(reopened, 'evaluate', [
      "console.log(require('/project/node_modules/ms')('2 days'));void 0",
    ]),
  ).toMatchObject({ result: { ok: true }, output: nativeMsOutput });
  await invoke(reopened, 'dispose');
});
