import { expect, test } from '@playwright/test';
const root = process.cwd().replaceAll('\\', '/');
for (const kind of ['legacy', 'corrupt', 'clean'])
  test(`SDK logger receives ${kind} layout truth before startup can publish HEAD`, async ({
    page,
  }) => {
    await page.goto('/no-coi-harness.html');
    const result = await page.evaluate(
      async ({ root, kind }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const namespace = `sdk-layout-${kind}`;
        const mount = await (await navigator.storage.getDirectory()).getDirectoryHandle(namespace, {
          create: true,
        });
        if (kind !== 'clean') {
          const target =
            kind === 'corrupt'
              ? await mount.getDirectoryHandle('.rifty-replica-v1', { create: true })
              : mount;
          const file = await target.getFileHandle(
            kind === 'corrupt' ? 'HEAD' : 'old-private-edit.txt',
            { create: true },
          );
          const writer = await file.createWritable();
          await writer.write('PRIVATE_OLD_BYTES');
          await writer.close();
        }
        const messages: string[] = [];
        const channel = new BroadcastChannel('no-coi-layout-proof');
        const observed = new Promise<number>((resolve) => {
          channel.onmessage = ({ data }) => resolve(data.headWrites);
        });
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          storage: { persistence: 'required', namespace },
          logger: {
            warn: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
            error: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
          },
          toolchain: {
            workerUrl: `/@fs${root}/tests/no-coi/fixtures/no-coi-layout-observer-worker.ts`,
          },
        });
        channel.postMessage('inspect');
        const headWrites = await observed;
        channel.close();
        const vfs = sandbox.vfs;
        sandbox.dispose();
        return { messages, headWrites, vfs };
      },
      { root, kind },
    );
    expect(result.headWrites).toBe(0);
    expect(result.vfs).toEqual({ backend: 'opfs' });
    if (kind === 'clean') expect(result.messages).toEqual([]);
    else {
      expect(result.messages.join('\n')).toMatch(
        kind === 'legacy' ? /legacy per-file OPFS/i : /corrupt/i,
      );
      expect(result.messages.join('\n')).not.toContain('PRIVATE_OLD_BYTES');
    }
  });

test('SDK logger also receives storage diagnosis from a restarted owner', async ({ page }) => {
  await page.goto('/no-coi-harness.html');
  const messages = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const messages: string[] = [];
    const namespace = 'sdk-layout-restart';
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      storage: { persistence: 'required', namespace },
      logger: {
        warn: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
      },
      toolchain: {
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      },
    });
    try {
      const mount = await (await navigator.storage.getDirectory()).getDirectoryHandle(namespace);
      const replica = await mount.getDirectoryHandle('.rifty-replica-v1');
      const writer = await (await replica.getFileHandle('HEAD', { create: true })).createWritable();
      await writer.write('CORRUPT_RESTART_PRIVATE');
      await writer.close();
      await sandbox.restart({ preview: { src: '' } });
      return messages;
    } finally {
      sandbox.dispose();
    }
  }, root);
  expect(messages.join('\n')).toMatch(/corrupt/i);
  expect(messages.join('\n')).not.toContain('CORRUPT_RESTART_PRIVATE');
});
