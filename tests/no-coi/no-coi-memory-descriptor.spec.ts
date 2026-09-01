import { type Page, expect, test } from '@playwright/test';

const workspacePath = process.cwd().replaceAll('\\', '/');
const sdkModuleUrl = `/@fs${workspacePath}/packages/rifty/src/index.ts`;
const toolchainWorkerUrl = `/@fs${workspacePath}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`;

const descriptorProbeExpression = `(() => {
  const observe = (nextShared) => {
    const log = [];
    let sharedReads = 0;
    const descriptor = Object.defineProperties({}, {
      initial: { get() { log.push('initial'); return 1; } },
      maximum: { get() { log.push('maximum'); return 1; } },
      shared: { get() { log.push('shared'); sharedReads += 1; return nextShared(sharedReads); } },
    });
    try {
      const memory = new WebAssembly.Memory(descriptor);
      return { log, sharedReads, bufferBrand: Object.prototype.toString.call(memory.buffer) };
    } catch (error) {
      return { log, sharedReads, error: { name: error.name, feature: error.feature } };
    }
  };
  return {
    falseThenTrue: observe((read) => read > 1),
    firstTruthy: observe(() => 'truthy'),
  };
})()`;

const expectedDescriptorOutcome = {
  falseThenTrue: {
    log: ['initial', 'maximum', 'shared'],
    sharedReads: 1,
    bufferBrand: '[object ArrayBuffer]',
  },
  firstTruthy: {
    log: ['initial', 'maximum', 'shared'],
    sharedReads: 1,
    error: { name: 'NotImplementedError', feature: 'toolchain.threaded-wasm' },
  },
} as const;

async function openHeaderlessPage(page: Page): Promise<void> {
  const response = await page.goto('/no-coi-harness.html');
  expect(response).not.toBeNull();
  if (response === null) throw new Error('headerless navigation returned no response');
  const headers = await response.allHeaders();
  expect(headers['cross-origin-opener-policy']).toBeUndefined();
  expect(headers['cross-origin-embedder-policy']).toBeUndefined();
  await expect(page.locator('#no-coi-harness')).toHaveAttribute('data-status', 'ready');
  expect(
    await page.evaluate(() => ({
      crossOriginIsolated,
      sharedArrayBufferType: typeof SharedArrayBuffer,
    })),
  ).toEqual({ crossOriginIsolated: false, sharedArrayBufferType: 'undefined' });
}

async function createToolchainSandbox(page: Page): Promise<void> {
  await page.evaluate(
    async ({ sdkUrl, selectedToolchainWorkerUrl }) => {
      const sdk = (await import(/* @vite-ignore */ sdkUrl)) as {
        createSandbox(options: Record<string, unknown>): Promise<unknown>;
      };
      const sandbox = (await sdk.createSandbox({
        requireCrossOriginIsolation: false,
        serviceWorkerUrl: '/sw.js',
        toolchain: { workerUrl: selectedToolchainWorkerUrl },
      })) as {
        runtime: { isReady(): boolean; on(fn: () => void): () => void };
        dispose(): void;
      };
      (
        globalThis as typeof globalThis & { __riftyDescriptorSandbox?: unknown }
      ).__riftyDescriptorSandbox = sandbox;
      if (sandbox.runtime.isReady()) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('runtime ready timeout')), 30_000);
        const off = sandbox.runtime.on(() => {
          if (!sandbox.runtime.isReady()) return;
          clearTimeout(timer);
          off();
          resolve();
        });
      });
    },
    { sdkUrl: sdkModuleUrl, selectedToolchainWorkerUrl: toolchainWorkerUrl },
  );
}

async function disposeToolchainSandbox(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = globalThis as typeof globalThis & {
      __riftyDescriptorSandbox?: { dispose(): void };
    };
    holder.__riftyDescriptorSandbox?.dispose();
    holder.__riftyDescriptorSandbox = undefined;
  });
}

test('headerless Chrome 148 native Memory reads descriptor fields once in order', async ({
  browser,
  page,
}) => {
  expect(browser.version()).toBe('148.0.7778.96');
  await openHeaderlessPage(page);
  const outcome = await page.evaluate(() => {
    const observe = (nextShared: (read: number) => unknown) => {
      const log: string[] = [];
      let sharedReads = 0;
      const descriptor = Object.defineProperties(
        {},
        {
          initial: {
            get() {
              log.push('initial');
              return 1;
            },
          },
          maximum: {
            get() {
              log.push('maximum');
              return 1;
            },
          },
          shared: {
            get() {
              log.push('shared');
              sharedReads += 1;
              return nextShared(sharedReads);
            },
          },
        },
      ) as WebAssembly.MemoryDescriptor;
      try {
        const memory = new WebAssembly.Memory(descriptor);
        return {
          log,
          sharedReads,
          bufferBrand: Object.prototype.toString.call(memory.buffer),
        };
      } catch (error) {
        const inspected = error as Error & { readonly feature?: string };
        return {
          log,
          sharedReads,
          error: { name: inspected.name, feature: inspected.feature },
        };
      }
    };
    return {
      falseThenTrue: observe((read) => read > 1),
      firstTruthy: observe(() => 'truthy'),
    };
  });

  expect(outcome.falseThenTrue).toEqual(expectedDescriptorOutcome.falseThenTrue);
  expect(outcome.firstTruthy).toEqual({
    log: ['initial', 'maximum', 'shared'],
    sharedReads: 1,
    bufferBrand: '[object SharedArrayBuffer]',
  });
});

test('public Worker REPL CJS ESM and arbitrary installed bin share native descriptor evaluation', async ({
  page,
}) => {
  await openHeaderlessPage(page);
  try {
    await createToolchainSandbox(page);
    const outcomes = await page.evaluate(
      async ({ probeExpression }) => {
        const sandbox = (
          globalThis as typeof globalThis & {
            __riftyDescriptorSandbox: {
              fs: { writeFile(path: string, value: string): Promise<void> };
              runtime: {
                eval(source: string): Promise<{ ok: boolean }>;
                on(fn: (event: { type: string; chunk?: string }) => void): () => void;
              };
              toolchain: {
                runBin(input: Record<string, unknown>): Promise<{ exitCode: number }>;
              };
            };
          }
        ).__riftyDescriptorSandbox;
        const root = '/descriptor-evaluation-siblings';
        const markers = {
          repl: '__RIFTY_DESCRIPTOR_REPL__',
          cjs: '__RIFTY_DESCRIPTOR_CJS__',
          esm: '__RIFTY_DESCRIPTOR_ESM__',
          bin: '__RIFTY_DESCRIPTOR_BIN__',
        } as const;
        await sandbox.fs.writeFile(`${root}/probe.cjs`, `module.exports = ${probeExpression};\n`);
        await sandbox.fs.writeFile(
          `${root}/probe.mjs`,
          `export const outcome = ${probeExpression};\n`,
        );
        await sandbox.fs.writeFile(
          `${root}/node_modules/.bin/descriptor-probe`,
          "#!/usr/bin/env node\nimport('../descriptor-probe/cli.js');\n",
        );
        await sandbox.fs.writeFile(
          `${root}/node_modules/descriptor-probe/package.json`,
          JSON.stringify({ name: 'descriptor-probe', type: 'commonjs' }),
        );
        await sandbox.fs.writeFile(
          `${root}/node_modules/descriptor-probe/cli.js`,
          `console.log(${JSON.stringify(markers.bin)} + JSON.stringify(${probeExpression}));\n`,
        );

        const stdout: string[] = [];
        const off = sandbox.runtime.on((event) => {
          if (event.type === 'stdout' && event.chunk) stdout.push(event.chunk);
        });
        const repl = await sandbox.runtime.eval(
          `console.log(${JSON.stringify(markers.repl)} + JSON.stringify(${probeExpression}))`,
        );
        const cjs = await sandbox.runtime.eval(
          `console.log(${JSON.stringify(markers.cjs)} + JSON.stringify(require(${JSON.stringify(`${root}/probe.cjs`)})))`,
        );
        const esm = await sandbox.runtime.eval(
          `__riftyImport(${JSON.stringify(`${root}/probe.mjs`)}).then(({ outcome }) => console.log(${JSON.stringify(markers.esm)} + JSON.stringify(outcome)))`,
        );
        const bin = await sandbox.toolchain.runBin({
          cwd: root,
          binPath: `${root}/node_modules/.bin/descriptor-probe`,
          args: [],
        });
        off();

        const text = stdout.join('');
        const read = (marker: string): unknown => {
          const line = text.split('\n').find((entry) => entry.startsWith(marker));
          if (line === undefined) throw new Error(`missing descriptor marker ${marker}`);
          return JSON.parse(line.slice(marker.length));
        };
        return {
          evalOk: { repl: repl.ok, cjs: cjs.ok, esm: esm.ok },
          bin,
          repl: read(markers.repl),
          cjs: read(markers.cjs),
          esm: read(markers.esm),
          installedBin: read(markers.bin),
        };
      },
      { probeExpression: descriptorProbeExpression },
    );

    expect(outcomes.evalOk).toEqual({ repl: true, cjs: true, esm: true });
    expect(outcomes.bin).toEqual({ exitCode: 0 });
    expect({
      repl: outcomes.repl,
      cjs: outcomes.cjs,
      esm: outcomes.esm,
      installedBin: outcomes.installedBin,
    }).toEqual({
      repl: expectedDescriptorOutcome,
      cjs: expectedDescriptorOutcome,
      esm: expectedDescriptorOutcome,
      installedBin: expectedDescriptorOutcome,
    });
  } finally {
    await disposeToolchainSandbox(page);
  }
});
