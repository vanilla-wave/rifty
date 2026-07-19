import { expect, test } from '@playwright/test';

const workspacePath = process.cwd().replaceAll('\\', '/');
const kernelModuleUrl = `/@fs${workspacePath}/packages/kernel/src/index.ts`;
const entryModuleUrl = `/@fs${workspacePath}/packages/kernel/tests/fixtures/capability-port-entry.ts`;

test('URL entry round-trips a protocol-opaque capability port', async ({ page }) => {
  await page.goto('/unit-harness.html');
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-status', 'ready');
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-coi', 'true');

  const result = await page.evaluate(
    async ({ entryUrl, kernelUrl }) => {
      const [hostAssets, kernel] = await Promise.all([
        import('/src/browser-unit/workbench-vite-host-assets.ts'),
        import(kernelUrl),
      ]);
      kernel.setKernelWorkerUrl(hostAssets.workbenchViteHostAssets.workers.kernel);
      const channel = new MessageChannel();
      channel.port1.start();

      const receive = (kind: string): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`timed out waiting for capability frame '${kind}'`)),
            10_000,
          );
          channel.port1.onmessage = (event) => {
            const frame = event.data as Record<string, unknown>;
            if (frame.kind !== kind) return;
            clearTimeout(timer);
            resolve(frame);
          };
        });

      const ready = receive('ready');
      const spawned = kernel.spawnKernelWorker(
        {
          entry: {
            kind: 'url',
            url: entryUrl,
            capabilityPorts: { 'browser.echo': channel.port2 },
          },
          argv: ['capability-port-entry'],
          env: {},
          cwd: '/',
          serve: true,
        },
        { pid: 20_001, ppid: 1 },
      );

      let stderr = '';
      spawned.ports.stderr.onmessage = (event: MessageEvent<Uint8Array>) => {
        stderr += new TextDecoder().decode(event.data);
      };
      spawned.ports.stderr.start();
      const exited = new Promise<never>((_, reject) => {
        spawned.onExit((code: number) => {
          reject(new Error(`kernel worker exited ${code} before round-trip: ${stderr}`));
        });
      });

      try {
        const readyFrame = await Promise.race([ready, exited]);
        const echoed = receive('echo');
        const payload = { text: 'opaque-capability-round-trip', sequence: 17 };
        channel.port1.postMessage(payload);
        const frame = await Promise.race([echoed, exited]);
        return { frame, readyFrame, stderr };
      } finally {
        spawned.terminate();
        channel.port1.close();
      }
    },
    { entryUrl: entryModuleUrl, kernelUrl: kernelModuleUrl },
  );

  expect(result.frame).toEqual({
    kind: 'echo',
    payload: { text: 'opaque-capability-round-trip', sequence: 17 },
  });
  expect(result.readyFrame).toEqual({
    kind: 'ready',
    ambientCapabilityGlobalPresent: false,
  });
  expect(result.stderr).toBe('');
});
