import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

for (const mode of ['fulfilled-hook', 'failed-hook', 'dirty-retry'] as const) {
  test(`Workbench owner waits for real session teardown admission: ${mode}`, async ({ page }) => {
    await gotoHarness(page);
    const result = await page.evaluate(
      async ({ root, mode }) => {
        const api = await import('/src/browser-unit/workbench-public-entry.ts');
        const { workbenchViteHostAssets: assets } = await import(
          '/src/browser-unit/workbench-vite-host-assets.ts'
        );
        const { inspectWorkbenchInternals } = await import(
          /* @vite-ignore */ `${root}/packages/workbench/src/workbench/open-workbench.ts`
        );
        const { defineNodeCliProject } = await import(
          /* @vite-ignore */ `${root}/packages/workbench/src/workbench/project-definition.ts`
        );
        const ownerUrl = new URL(assets.workers.owner, location.href);
        const base = document.createElement('base');
        base.href = new URL('.', ownerUrl).href;
        document.head.prepend(base);
        const workbench = await api.openWorkbench({
          deployment: {
            workers: { ...assets.workers, owner: ownerUrl.href.slice(base.href.length) },
            serviceWorker: { url: '/sw.js', scope: '/' },
            wasm: assets.wasm,
          },
          packageAcquisition: { registryUrl: '/npm-registry' },
          storage: { persistence: 'ephemeral' },
        });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const hookFailure = new Error('actual pre-close hook failed');
        let hookCalls = 0;
        let close: Promise<unknown> | undefined;
        try {
          const session = await workbench.openProject(
            defineNodeCliProject({
              id: 'close-admission',
              entryPath: '/main.cjs',
              files: { '/main.cjs': 'console.log("admission")', '/proof.txt': 'owner-alive' },
            }),
          );
          const internals = inspectWorkbenchInternals(workbench);
          internals.registerBeforeClose(session, async () => {
            hookCalls++;
            await gate;
            if (mode === 'failed-hook') throw hookFailure;
          });
          let dirtyRejected = false;
          if (mode === 'dirty-retry') {
            const document = await session.documents.open('/proof.txt');
            document.replace('dirty');
            try {
              await workbench.close();
            } catch (error) {
              dirtyRejected = (error as Error).name === 'DirtyProjectDocumentError';
            }
            if (hookCalls !== 0) throw new Error('dirty preflight admitted hook');
            await document.close({ dirty: 'discard' });
          }
          let ownerClosed = false;
          void internals.owner.closed.then(
            () => {
              ownerClosed = true;
            },
            () => {
              ownerClosed = true;
            },
          );
          close = workbench.close().then(
            () => null,
            (error: unknown) => error,
          );
          // Let the parent's existing preflight checkpoint dispatch; the following real
          // owner RPC must remain admitted until the delayed hook releases core teardown.
          for (let i = 0; i < 12; i++) await Promise.resolve();
          let bytes: string | null = null;
          let readError: string | null = null;
          try {
            bytes = new TextDecoder().decode((await session.files.readFile('/proof.txt')).bytes);
          } catch (error) {
            readError = (error as Error).message;
          }
          const closedBeforeRelease = ownerClosed;
          release();
          const failure = await close;
          const ownerAfterClose = await internals.owner.closed.then(
            () => true,
            () => false,
          );
          const contains = (error: unknown): boolean =>
            error === hookFailure ||
            (error instanceof AggregateError && error.errors.some(contains));
          return {
            bytes,
            readError,
            closedBeforeRelease,
            hookCalls,
            dirtyRejected,
            ownerAfterClose,
            closeSucceeded: failure === null,
            originalHookFailure: contains(failure),
          };
        } finally {
          release();
          await close;
          await workbench.close().catch(() => {});
          base.remove();
        }
      },
      { root: `/@fs${process.cwd()}`, mode },
    );
    expect(result).toEqual({
      bytes: 'owner-alive',
      readError: null,
      closedBeforeRelease: false,
      hookCalls: 1,
      dirtyRejected: mode === 'dirty-retry',
      ownerAfterClose: true,
      closeSucceeded: mode !== 'failed-hook',
      originalHookFailure: mode === 'failed-hook',
    });
  });
}
