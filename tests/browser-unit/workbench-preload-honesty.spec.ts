import { expect, test } from '@playwright/test';
import {
  attemptBootOwner,
  bootOwner,
  closeOwner,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
} from './fixtures.ts';
import {
  denyNamespacePreloadReads,
  nativeRootNames,
  readNativeFiles,
  seedNamespaceOrigin,
} from './fixtures/opfs-storage-namespace.ts';

for (const persistence of ['required', 'preferred'] as const) {
  for (const mode of ['getFile', 'arrayBuffer'] as const) {
    test(`public ${persistence} rejects acquired-tree ${mode} refusal without memory success or native byte loss`, async ({
      page,
    }) => {
      await gotoHarness(page);
      await seedNamespaceOrigin(page);
      const paths = ['/outside-sentinel.bin', '/existing.bin', '/A/existing.bin', '/blocked'];
      const before = await readNativeFiles(page, paths);
      const rootNames = await nativeRootNames(page);
      const restore = await denyNamespacePreloadReads(page, 'A', mode);
      const options = {
        workspaceId: 'namespace-preload-fault',
        namespace: 'A',
        persistence,
      } as const;
      try {
        const attempt = await attemptBootOwner(page, options);
        const storage = await page.evaluate(async (url) => {
          const fixture = await import(/* @vite-ignore */ url);
          try {
            return fixture.currentWorkbench().snapshot().storage;
          } catch {
            return null;
          }
        }, sealedWorkbenchFixtureUrl);
        console.log(
          '[workbench-preload-honesty]',
          JSON.stringify({ persistence, mode, attempt, storage }),
        );
        expect.soft(attempt.ok).toBe(false);
        expect.soft(attempt.messages.join('\n')).toContain('OPFS persisted tree preload failed');
        expect
          .soft(attempt.messages.join('\n'))
          .toContain(`namespace-preload-denied:${mode}:A/existing.bin`);
        expect.soft(storage).toBeNull();
      } finally {
        await closeOwner(page);
        await restore();
      }
      expect.soft(await nativeRootNames(page)).toEqual(rootNames);
      expect(await readNativeFiles(page, paths)).toEqual(before);
      try {
        await bootOwner(page, { ...options, persistence: 'required' });
        expect(
          await page.evaluate(async (url) => {
            const fixture = await import(/* @vite-ignore */ url);
            return fixture.currentWorkbench().snapshot().storage;
          }, sealedWorkbenchFixtureUrl),
        ).toEqual({ policy: 'required', backend: 'opfs', durability: 'durable' });
      } finally {
        await closeOwner(page);
      }
      expect(await readNativeFiles(page, paths)).toEqual(before);
    });
  }
}
