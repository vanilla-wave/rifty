import { expect, test } from '@playwright/test';
import {
  attemptBootOwner,
  bootOwner,
  closeOwner,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
} from './fixtures.ts';

const ORPHAN_TEXT = 'orphan bytes';
const NESTED_TEXT = 'nested orphan';
const DEP_TEXT = 'module.exports = 1;\n';

test('unjournaled orphan Scratch is retained for download across a namespaced OPFS reopen (I6)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoHarness(page);

  const namespace = `i6-ns-${crypto.randomUUID()}`;
  const hostName = `i6-host-${crypto.randomUUID()}.txt`;

  await page.evaluate(
    async ({ ns, host, orphan, nested, dep }) => {
      const encoder = new TextEncoder();
      const origin = await navigator.storage.getDirectory();
      const hostFile = await origin.getFileHandle(host, { create: true });
      const hostWriter = await hostFile.createWritable();
      await hostWriter.write(encoder.encode('origin host sentinel'));
      await hostWriter.close();

      const walk = async (
        start: FileSystemDirectoryHandle,
        segments: readonly string[],
      ): Promise<FileSystemDirectoryHandle> => {
        let current = start;
        for (const segment of segments) {
          current = await current.getDirectoryHandle(segment, { create: true });
        }
        return current;
      };

      const root = await walk(origin, ns.split('/'));
      const tree = await walk(root, ['.rifty', 'workbench', 'v1', 'projects', 'scratch', 'tree']);
      const src = await tree.getDirectoryHandle('src', { create: true });
      const pkg = await walk(tree, ['node_modules', 'pkg']);
      const write = async (dir: FileSystemDirectoryHandle, name: string, text: string) => {
        const file = await dir.getFileHandle(name, { create: true });
        const writer = await file.createWritable();
        await writer.write(encoder.encode(text));
        await writer.close();
      };
      await write(tree, 'user.txt', orphan);
      await write(src, 'note.txt', nested);
      await write(pkg, 'index.js', dep);
    },
    { ns: namespace, host: hostName, orphan: ORPHAN_TEXT, nested: NESTED_TEXT, dep: DEP_TEXT },
  );

  const firstBoot = await attemptBootOwner(page, {
    workspaceId: `i6-orphan-${namespace}`,
    hiddenEmptyBoot: true,
    persistence: 'required',
    namespace,
  });
  expect(firstBoot).toEqual({ ok: true, messages: [] });

  const firstRead = await page.evaluate(async (fixtureUrl) => {
    const fixture = (await import(/* @vite-ignore */ fixtureUrl)) as {
      currentWorkbench(): {
        readonly playground: {
          readonly catalog: {
            listRetainedOrphans(): Promise<readonly { readonly id: string }[]>;
            listRetainedOrphanEntries(id: string): Promise<readonly { readonly path: string }[]>;
            readRetainedOrphanFile(id: string, path: string): Promise<Uint8Array>;
          };
        };
      };
    };
    const catalog = fixture.currentWorkbench().playground.catalog;
    const orphans = await catalog.listRetainedOrphans();
    const id = orphans[0]?.id;
    if (id === undefined)
      return { orphans: orphans.length, id: '', paths: [], user: '', nested: '', dep: '' };
    const decoder = new TextDecoder();
    const entries = await catalog.listRetainedOrphanEntries(id);
    return {
      orphans: orphans.length,
      id,
      paths: entries.map((entry) => entry.path).sort(),
      user: decoder.decode(await catalog.readRetainedOrphanFile(id, 'user.txt')),
      nested: decoder.decode(await catalog.readRetainedOrphanFile(id, 'src/note.txt')),
      dep: decoder.decode(await catalog.readRetainedOrphanFile(id, 'node_modules/pkg/index.js')),
    };
  }, sealedWorkbenchFixtureUrl);

  expect(firstRead.orphans).toBe(1);
  expect(firstRead.id).toMatch(/^orphan-scratch-/);
  expect(firstRead.paths).toEqual(['node_modules/pkg/index.js', 'src/note.txt', 'user.txt']);
  expect(firstRead.user).toBe(ORPHAN_TEXT);
  expect(firstRead.nested).toBe(NESTED_TEXT);
  expect(firstRead.dep).toBe(DEP_TEXT);

  const originAfter = await page.evaluate(
    async ({ ns, host }) => {
      const origin = await navigator.storage.getDirectory();
      const names: string[] = [];
      for await (const [name] of origin.entries()) names.push(name);
      return {
        names: names.sort(),
        hasHost: names.includes(host),
        hasNamespace: names.includes(ns),
        hasRiftyAtOrigin: names.includes('.rifty'),
      };
    },
    { ns: namespace, host: hostName },
  );
  expect(originAfter.hasHost).toBe(true);
  expect(originAfter.hasNamespace).toBe(true);
  expect(originAfter.hasRiftyAtOrigin).toBe(false);

  await closeOwner(page);
  await bootOwner(page, {
    workspaceId: `i6-orphan-${namespace}`,
    hiddenEmptyBoot: true,
    persistence: 'required',
    namespace,
  });

  const afterReload = await page.evaluate(async (fixtureUrl) => {
    const fixture = (await import(/* @vite-ignore */ fixtureUrl)) as {
      currentWorkbench(): {
        readonly playground: {
          readonly catalog: {
            listRetainedOrphans(): Promise<readonly { readonly id: string }[]>;
            readRetainedOrphanFile(id: string, path: string): Promise<Uint8Array>;
          };
        };
      };
    };
    const catalog = fixture.currentWorkbench().playground.catalog;
    const orphans = await catalog.listRetainedOrphans();
    const id = orphans[0]?.id;
    if (id === undefined) return { orphans: 0, user: '' };
    return {
      orphans: orphans.length,
      user: new TextDecoder().decode(await catalog.readRetainedOrphanFile(id, 'user.txt')),
    };
  }, sealedWorkbenchFixtureUrl);

  expect(afterReload.orphans).toBe(1);
  expect(afterReload.user).toBe(ORPHAN_TEXT);
});
