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
export async function startFault(page: Page, namespace: string, mode: string, materialize = false) {
  return page.evaluate(
    async ({ clientUrl, ownerModule, namespace, mode, materialize }) => {
      const client = await import(/* @vite-ignore */ clientUrl);
      const owner = await import(/* @vite-ignore */ ownerModule);
      const channel = new BroadcastChannel('legacy-layout-cut');
      const armed = new Promise<void>((resolve) => {
        channel.onmessage = ({ data }) => {
          if (data.armed) resolve();
        };
      });
      const timer = setInterval(() => channel.postMessage({ mode }), 25);
      const open = client.boot(namespace, owner.default).then(
        async () => {
          if (materialize) await client.materialize();
          return { ok: true, error: '' };
        },
        (error: unknown) => ({ ok: false, error: String(error) }),
      );
      const outcome = open.catch((error: unknown) => ({ ok: false, error: String(error) }));
      await armed;
      clearInterval(timer);
      if (mode.endsWith('quota')) {
        const result = await outcome;
        channel.close();
        return result;
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
    { clientUrl, ownerModule, namespace, mode, materialize },
  );
}
