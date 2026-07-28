import { type Page, expect, test } from '@playwright/test';

const workspacePath = process.cwd().replaceAll('\\', '/');
const processManagerModuleUrl = `/@fs${workspacePath}/packages/kernel/src/process-manager.ts`;
const spawnWorkerModuleUrl = `/@fs${workspacePath}/packages/kernel/src/spawn-worker.ts`;
const hostAssetsModuleUrl = '/src/browser-unit/workbench-vite-host-assets.ts';

type RealWorkerScenario = 'natural' | 'busy-signal' | 'global-error' | 'canceled-global-error';

interface RealWorkerResult {
  readonly coi: boolean;
  readonly events: readonly string[];
  readonly exitCode: number | null;
  readonly live: boolean;
  readonly signalCode: string | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly terminateCalls: number;
}

async function runRealWorker(page: Page, scenario: RealWorkerScenario): Promise<RealWorkerResult> {
  await page.goto('/unit-harness.html');
  return await page.evaluate(
    async ({ hostAssetsUrl, processManagerUrl, scenario, spawnWorkerUrl }) => {
      const [{ ProcessManager }, spawnWorker, hostAssets] = await Promise.all([
        import(/* @vite-ignore */ processManagerUrl),
        import(/* @vite-ignore */ spawnWorkerUrl),
        import(/* @vite-ignore */ hostAssetsUrl),
      ]);
      const kernelWorkerUrl = hostAssets.workbenchViteHostAssets.workers.kernel;
      let terminateCalls = 0;
      spawnWorker.setKernelWorkerUrl(kernelWorkerUrl);
      spawnWorker.setWorkerFactoryForTests((url: string | URL) => {
        const real = new Worker(url, { type: 'module' });
        return {
          postMessage(message: unknown, transfer?: readonly Transferable[]) {
            real.postMessage(message, transfer as Transferable[] | undefined);
          },
          terminate() {
            terminateCalls++;
            real.terminate();
          },
          addEventListener(type: string, listener: (event: MessageEvent) => void) {
            real.addEventListener(type, listener as EventListener);
          },
          removeEventListener(type: string, listener: (event: MessageEvent) => void) {
            real.removeEventListener(type, listener as EventListener);
          },
        };
      });

      const source =
        scenario === 'natural'
          ? `
              process.stdout.write('real-natural-stdout');
              process.stderr.write('real-natural-stderr');
            `
          : scenario === 'busy-signal'
            ? `
                process.stdout.write('real-busy-ready');
                while (true) {}
              `
            : scenario === 'global-error'
              ? `
                  process.stdout.write('before-real-global-error');
                  setTimeout(() => {
                    throw new Error('real-global-error');
                  }, 0);
                  await new Promise(() => {});
                `
              : `
                  globalThis.addEventListener('error', (event) => {
                    event.preventDefault();
                  });
                  setTimeout(() => {
                    throw new Error('real-canceled-global-error');
                  }, 0);
                  await new Promise((resolve) => setTimeout(resolve, 50));
                  process.stdout.write('after-real-canceled-global-error');
                `;
      const manager = new ProcessManager();
      const handle = manager.spawnWorker(`real-${scenario}`, {
        entry: {
          kind: 'source',
          code: source,
          sourceUrl: `browser-unit://real-${scenario}.js`,
        },
        argv: [`real-${scenario}`],
        env: {},
        cwd: '/',
        ...(scenario === 'natural' || scenario === 'canceled-global-error' ? {} : { serve: true }),
      });
      if (handle.kind !== 'worker') throw new Error('expected real Worker handle');

      const events: string[] = [];
      let stdout = '';
      let stderr = '';
      let ready: (() => void) | undefined;
      const outputReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      handle.stdout().on('data', (chunk: Uint8Array) => {
        stdout += new TextDecoder().decode(chunk);
        events.push('stdout');
        if (
          stdout.includes('real-busy-ready') ||
          stdout.includes('after-real-canceled-global-error')
        ) {
          ready?.();
        }
      });
      handle.stderr().on('data', (chunk: Uint8Array) => {
        stderr += new TextDecoder().decode(chunk);
        events.push('stderr');
      });
      handle.on('exit', (code: number | null, signal: string | null) => {
        events.push(`exit:${String(code)}/${String(signal)}`);
      });
      handle.on('peererror', () => events.push('peererror'));
      const closed = new Promise<void>((resolve) => {
        handle.on('close', (code: number | null, signal: string | null) => {
          events.push(`close:${String(code)}/${String(signal)}`);
          resolve();
        });
      });
      const within = <T>(promise: Promise<T>, label: string): Promise<T> =>
        Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 10_000);
          }),
        ]);

      try {
        if (scenario === 'busy-signal') {
          await within(outputReady, 'real busy Worker stdout');
          if (!handle.kill('SIGTERM')) throw new Error('busy Worker refused SIGTERM');
        }
        await within(closed, `real ${scenario} Worker close`);
        return {
          coi: globalThis.crossOriginIsolated === true,
          events,
          exitCode: handle.exitCode,
          live: manager.get(handle.pid) !== null,
          signalCode: handle.signalCode,
          stderr,
          stdout,
          terminateCalls,
        };
      } finally {
        if (manager.get(handle.pid) !== null) handle.kill('SIGTERM');
        spawnWorker.clearWorkerFactoryForTests();
        spawnWorker.clearKernelDispatcher();
      }
    },
    {
      hostAssetsUrl: hostAssetsModuleUrl,
      processManagerUrl: processManagerModuleUrl,
      scenario,
      spawnWorkerUrl: spawnWorkerModuleUrl,
    },
  );
}

test('real Chromium Worker drains natural final stdout/stderr before exit then close', async ({
  page,
}) => {
  const result = await runRealWorker(page, 'natural');

  expect(result.coi).toBe(true);
  expect(result.stdout).toBe('real-natural-stdout');
  expect(result.stderr).toBe('real-natural-stderr');
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeNull();
  expect(result.live).toBe(false);
  expect(result.terminateCalls).toBe(1);
  const exitIndex = result.events.indexOf('exit:0/null');
  expect(exitIndex).toBeGreaterThan(result.events.lastIndexOf('stdout'));
  expect(exitIndex).toBeGreaterThan(result.events.lastIndexOf('stderr'));
  expect(result.events.at(-1)).toBe('close:0/null');
});

test('real Chromium busy-loop Worker settles SIGTERM without child cooperation', async ({
  page,
}) => {
  const result = await runRealWorker(page, 'busy-signal');

  expect(result.coi).toBe(true);
  expect(result.stdout).toBe('real-busy-ready');
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBeNull();
  expect(result.signalCode).toBe('SIGTERM');
  expect(result.live).toBe(false);
  expect(result.terminateCalls).toBe(1);
  expect(result.events).toContain('exit:null/SIGTERM');
  expect(result.events.at(-1)).toBe('close:null/SIGTERM');
});

test('real Chromium global Worker error preserves output and settles failure once', async ({
  page,
}) => {
  const result = await runRealWorker(page, 'global-error');

  expect(result.coi).toBe(true);
  expect(result.stdout).toBe('before-real-global-error');
  expect(result.stderr).toContain('real-global-error');
  expect(result.exitCode).toBe(1);
  expect(result.signalCode).toBeNull();
  expect(result.live).toBe(false);
  expect(result.terminateCalls).toBe(1);
  expect(result.events.filter((event) => event.startsWith('exit:'))).toEqual(['exit:1/null']);
  expect(result.events.at(-1)).toBe('close:1/null');
});

test('canceling a real Chromium Worker global error leaves output open for clean completion', async ({
  page,
}) => {
  const result = await runRealWorker(page, 'canceled-global-error');

  expect(result.coi).toBe(true);
  expect(result.stdout).toBe('after-real-canceled-global-error');
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeNull();
  expect(result.live).toBe(false);
  expect(result.terminateCalls).toBe(1);
  expect(result.events).not.toContain('peererror');
  expect(result.events.filter((event) => event.startsWith('exit:'))).toEqual(['exit:0/null']);
  expect(result.events.at(-1)).toBe('close:0/null');
});
