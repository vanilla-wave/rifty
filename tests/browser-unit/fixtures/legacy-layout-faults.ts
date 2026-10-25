import type { Page } from '@playwright/test';
const clientUrl = `/@fs${process.cwd()}/tests/browser-unit/fixtures/legacy-layout-workbench.ts`;
const ownerModule = `/@fs${process.cwd()}/tests/browser-unit/fixtures/legacy-layout-fault-owner.ts?worker&url`;
export async function corruptHead(page: Page, namespace: string) {
  await page.evaluate(async (namespace) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(namespace, {
      create: true,
    });
    const replica = await root.getDirectoryHandle('.rifty-replica-v1', { create: true });
    const head = await replica.getFileHandle('HEAD', { create: true });
    const writer = await head.createWritable();
    await writer.write('invalid HEAD sentinel');
    await writer.close();
  }, namespace);
}
export async function startFault(
  page: Page,
  namespace: string,
  mode: string,
  materialize = false,
  persistence: 'required' | 'preferred' = 'required',
) {
  return page.evaluate(
    async ({ clientUrl, ownerModule, namespace, mode, materialize, persistence }) => {
      const describe = (error: unknown): string =>
        error instanceof Error
          ? [
              `${error.name}: ${error.message}`,
              ...(error instanceof AggregateError ? error.errors.map(describe) : []),
              ...(error.cause === undefined ? [] : [describe(error.cause)]),
            ].join('; ')
          : String(error);
      const client = await import(/* @vite-ignore */ clientUrl);
      const owner = await import(/* @vite-ignore */ ownerModule);
      const channel = new BroadcastChannel('legacy-layout-cut');
      const denied: string[] = [];
      const armed = new Promise<void>((resolve) => {
        channel.onmessage = ({ data }) => {
          if (data.denied) denied.push(data.denied);
          if (data.armed) resolve();
        };
      });
      const timer = setInterval(() => channel.postMessage({ mode }), 25);
      const open = client.boot(namespace, owner.default, persistence).then(
        async () => {
          if (materialize) await client.materialize();
          return { ok: true, error: '' };
        },
        (error: unknown) => ({ ok: false, error: describe(error) }),
      );
      const outcome = open.catch((error: unknown) => ({ ok: false, error: describe(error) }));
      await armed;
      clearInterval(timer);
      if (mode.endsWith('quota')) {
        const result = await outcome;
        channel.close();
        return { ...result, denied };
      }
      return await Promise.race([
        outcome,
        new Promise<{ ok: boolean; error: string }>((resolve) => {
          channel.onmessage = ({ data }) => {
            if (data.cut) {
              channel.close();
              resolve({ ok: true, error: data.cut });
            }
          };
        }),
      ]);
    },
    { clientUrl, ownerModule, namespace, mode, materialize, persistence },
  );
}
