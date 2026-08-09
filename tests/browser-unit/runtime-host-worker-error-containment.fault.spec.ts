import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/u, '');

test('public spawnRuntime owns a real Worker crash exactly once', async ({ page }) => {
  await page.goto('/unit-harness.html');

  const result = await page.evaluate(
    async ({ root }) => {
      interface RuntimeEvent {
        readonly type: string;
        readonly chunk?: string;
        readonly reason?: string;
      }

      const host = (await import(
        /* @vite-ignore */ `/@fs${root}/packages/runtime-js/src/host.ts`
      )) as {
        spawnRuntime(options: { readonly workerUrl: string }): {
          eval(code: string): Promise<unknown>;
          on(handler: (event: RuntimeEvent) => void): () => void;
          dispose(): void;
        };
      };
      const creatorErrors: string[] = [];
      const onCreatorError = (event: ErrorEvent): void => {
        creatorErrors.push(event.message);
        event.preventDefault();
      };
      globalThis.addEventListener('error', onCreatorError);

      const workerUrl = `/@fs${root}/packages/runtime-js/src/worker-entry.ts`;
      const runtime = host.spawnRuntime({ workerUrl });
      const events: RuntimeEvent[] = [];
      const detach = runtime.on((event) => events.push(event));
      try {
        const failure = runtime
          .eval(`
            await new Promise(() => {
              setTimeout(() => {
                throw new Error('runtime-host-real-crash');
              }, 0);
            });
          `)
          .then(
            () => ({ resolved: true as const, code: null, message: null }),
            (error: unknown) => {
              const candidate = error as { readonly code?: unknown; readonly message?: unknown };
              return {
                resolved: false as const,
                code: typeof candidate.code === 'string' ? candidate.code : null,
                message: typeof candidate.message === 'string' ? candidate.message : null,
              };
            },
          );
        const outcome = await Promise.race([
          failure,
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error('timed out waiting for runtime crash')), 10_000);
          }),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { creatorErrors, events, outcome };
      } finally {
        detach();
        runtime.dispose();
        globalThis.removeEventListener('error', onCreatorError);
      }
    },
    { root: repoRoot },
  );

  expect(result.outcome).toMatchObject({
    resolved: false,
    code: 'WORKER_CRASHED',
  });
  expect(result.outcome.message).toContain('runtime-host-real-crash');
  expect(result.creatorErrors).toEqual([]);
  expect(
    result.events.filter(
      (event) => event.type === 'stderr' && event.chunk?.includes('runtime-host-real-crash'),
    ),
  ).toEqual([
    expect.objectContaining({ chunk: expect.stringContaining('runtime-host-real-crash') }),
  ]);
  expect(result.events.filter((event) => event.type === 'exit')).toEqual([
    { type: 'exit', reason: 'error' },
  ]);
});
