import { nativeReplicaProbeSource } from './fixtures/native-replica-page.ts';
import { expect, test } from './fixtures/test.ts';

const root = process.cwd().replaceAll('\\', '/');

test('early runtime subscription observes real boot and survives resolve and restart', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(async (root) => {
    const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const events: { type: string; operation?: string; phase?: string }[] = [];
    const opening = sdk.createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      storage: { namespace: 'kit-lifecycle', persistence: 'required' },
      toolchain: {
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      },
    });
    const detach = Reflect.get(opening, 'runtime')?.on((event: { type: string }) =>
      events.push(event),
    );
    const sandbox = await opening;
    try {
      const beforeResolve = [...events];
      await sandbox.restart({ preview: { src: '' } });
      const afterRestart = [...events];
      detach?.();
      await sandbox.restart({ preview: { src: '' } });
      return { beforeResolve, afterRestart, afterDetach: events };
    } finally {
      sandbox.dispose();
    }
  }, root);
  const phases = (events: typeof value.beforeResolve) =>
    events.filter((e) => e.type === 'progress' && e.operation === 'boot').map((e) => e.phase);
  expect(phases(value.beforeResolve)).toEqual([
    'worker-spawned',
    'storage-admitted',
    'toolchain-ready',
  ]);
  expect(phases(value.afterRestart)).toEqual([
    ...phases(value.beforeResolve),
    ...phases(value.beforeResolve),
  ]);
  expect(value.afterDetach).toEqual(value.afterRestart);
});

for (const startupTimeoutMs of [5000, 60000]) {
  test(`native occupied is discriminable under startup deadline ${startupTimeoutMs}`, async ({
    page,
    context,
  }) => {
    await page.goto('/no-coi-harness.html');
    const namespace = `kit-occupied-${startupTimeoutMs}`;
    await page.evaluate(
      async ({ root, namespace }) => {
        const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const holder = await sdk.createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          storage: { namespace, persistence: 'required' },
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          },
        });
        Reflect.set(globalThis, 'kitHolder', holder);
      },
      { root, namespace },
    );
    const other = await context.newPage();
    await other.goto('/no-coi-harness.html');
    try {
      const result = await other.evaluate(
        async ({ root, namespace, startupTimeoutMs }) => {
          const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
          const events: unknown[] = [];
          const opening = sdk.createSandbox({
            requireCrossOriginIsolation: false,
            skipServiceWorker: true,
            startupTimeoutMs,
            storage: { namespace, persistence: 'preferred' },
            toolchain: {
              workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
            },
          });
          Reflect.get(opening, 'runtime')?.on((event: unknown) => events.push(event));
          try {
            const sandbox = await opening;
            sandbox.dispose();
            return { events, error: null };
          } catch (error) {
            const failure = error as Error;
            return {
              events,
              error: {
                name: failure.name,
                message: failure.message,
                cause: failure.cause,
                kind: Reflect.get(sdk, 'sandboxErrorKind')?.(error),
              },
            };
          }
        },
        { root, namespace, startupTimeoutMs },
      );
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: 'progress',
          operation: 'boot',
          phase: 'waiting-for-storage-writer',
        }),
      );
      expect(result.error).toMatchObject({
        kind: 'occupied',
        cause: expect.objectContaining({ name: 'NoModificationAllowedError' }),
      });
      if (startupTimeoutMs === 60000) expect(result.error?.name).toBe('OpfsPreloadError');
      await page.evaluate(() => Reflect.get(globalThis, 'kitHolder').dispose());
      const backend = await other.evaluate(
        async ({ root, namespace }) => {
          const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
          const sandbox = await sdk.createSandbox({
            requireCrossOriginIsolation: false,
            skipServiceWorker: true,
            storage: { namespace, persistence: 'required' },
            toolchain: {
              workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
            },
          });
          try {
            return sandbox.vfs.backend;
          } finally {
            sandbox.dispose();
          }
        },
        { root, namespace },
      );
      expect(backend).toBe('opfs');
    } finally {
      await page.evaluate(() => Reflect.get(globalThis, 'kitHolder').dispose());
      await other.close();
    }
  });
}

test('root discriminator identifies real run/fs/install overlap and restart-busy', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(async (root) => {
    const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const kind = (error: unknown) => Reflect.get(sdk, 'sandboxErrorKind')?.(error);
    const sandbox = await sdk.createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      storage: { persistence: 'ephemeral' },
      toolchain: {
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      },
    });
    try {
      const project = sandbox.project({ root: '/probe' });
      await project.fs.writeFile('package.json', '{"name":"probe","version":"1.0.0"}');
      let entered!: () => void;
      const entrance = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const active = project.run('echo BUSY_ENTERED && sleep 20');
      active.onOutput(({ chunk }: { chunk: string }) => {
        if (chunk.includes('BUSY_ENTERED')) entered();
      });
      await Promise.race([
        entrance,
        active.completion.then(() => {
          throw new Error('Command never entered');
        }),
      ]);
      const overlap = await project.run('echo forbidden-overlap').completion;
      const file = await project.fs.writeFile('forbidden.txt', 'bad').then(() => 'written', kind);
      const install = await sandbox.toolchain
        .install({ cwd: '/probe', registryUrl: '/not-fetched' })
        .then(() => 'installed', kind);
      await active.stop();
      const notWritten = await project.fs.readFile('forbidden.txt', 'utf8').then(
        () => false,
        (error: { code?: string }) => error.code === 'ENOENT',
      );
      let opened!: () => void;
      let release!: () => void;
      const opening = new Promise<void>((resolve) => {
        opened = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const restarting = sandbox.restart({
        preview: { src: '' },
        beforeStart: async () => {
          opened();
          await held;
        },
      });
      await opening;
      const restart = await sandbox.restart({ preview: { src: '' } }).then(() => 'restarted', kind);
      release();
      await restarting;
      return {
        run: kind(overlap.error),
        file,
        install,
        restart,
        notWritten,
        unrelated: kind(new Error('ordinary')),
        prototype: kind({ name: 'toString' }),
      };
    } finally {
      sandbox.dispose();
    }
  }, root);
  expect(value).toEqual({
    run: 'busy',
    file: 'busy',
    install: 'busy',
    restart: 'restart-busy',
    notWritten: true,
    unrelated: undefined,
    prototype: undefined,
  });
});

for (const fault of ['permission', 'unobserved', 'wait-hydrate'] as const) {
  test(`startup ${fault} cannot masquerade as occupied`, async ({ page }) => {
    await page.goto('/no-coi-harness.html');
    const result = await page.evaluate(
      async ({ root, fault }) => {
        const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const options = {
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          storage: { namespace: 'kit-negative', persistence: 'required' },
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          },
        };
        const holder = fault === 'wait-hydrate' ? await sdk.createSandbox(options) : undefined;
        if (holder) await holder.fs.writeFile('/seed', 'persisted HEAD');
        const native: string[] = [];
        const NativeWorker = Worker;
        globalThis.Worker = new Proxy(NativeWorker, {
          construct(target, args: ConstructorParameters<typeof Worker>) {
            const worker = Reflect.construct(target, args) as Worker;
            worker.addEventListener('message', ({ data }) => {
              if (data.type === 'native-contention-observed') {
                native.push(data.type);
                holder?.dispose();
              }
              if (data.type === 'native-hydrate-held') native.push(data.type);
            });
            return worker;
          },
        });
        try {
          const events: { type: string; operation?: string; phase?: string }[] = [];
          const opening = sdk.createSandbox({
            ...options,
            startupTimeoutMs: 5000,
            toolchain: {
              workerUrl: `/@fs${root}/tests/no-coi/fixtures/sdk-lifecycle-fault-worker.ts?fault=${fault}`,
            },
          });
          Reflect.get(opening, 'runtime')?.on((event: (typeof events)[number]) =>
            events.push(event),
          );
          const failure = await opening.then(
            (sandbox) => {
              sandbox.dispose();
              return { name: 'resolved', kind: 'resolved', message: '' };
            },
            (error: Error) => ({
              name: error.name,
              kind: Reflect.get(sdk, 'sandboxErrorKind')?.(error),
              message: error.message,
            }),
          );
          return { events, native, failure };
        } finally {
          globalThis.Worker = NativeWorker;
          holder?.dispose();
        }
      },
      { root, fault },
    );
    expect(result.failure.kind).toBeUndefined();
    expect(result.failure.name).not.toBe('resolved');
    if (fault === 'wait-hydrate') {
      expect(result.native).toContain('native-contention-observed');
      expect(result.native).toContain('native-hydrate-held');
      expect(result.events.filter((e) => e.type === 'progress').map((e) => e.phase)).toEqual([
        'worker-spawned',
        'waiting-for-storage-writer',
        'storage-admitted',
      ]);
    } else {
      expect(result.events.filter((e) => e.phase === 'waiting-for-storage-writer')).toEqual([]);
    }
  });
}

test('native mutation failure remains a discriminable persistence receipt', async ({ page }) => {
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(
    async ({ root, nativeReplicaProbeSource }) => {
      const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const sandbox = await sdk.createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        storage: { persistence: 'required', namespace: 'kit-quota' },
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      try {
        await sandbox.fs.writeFile('/quota/seed', 'seed');
        const patched = await sandbox.runtime.eval(`${nativeReplicaProbeSource}
observeNativeReplicaWrites(records => { if (records.some(record => record.path === '/quota/fault.txt' && record.kind === 'file')) throw new DOMException('kit quota', 'QuotaExceededError'); });`);
        if (!patched.ok) throw new Error('Native quota boundary failed');
        const project = sandbox.project({ root: '/quota' });
        const file = await project.fs.writeFile('fault.txt', 'file').then(
          () => 'written',
          (error: unknown) => Reflect.get(sdk, 'sandboxErrorKind')?.(error),
        );
        const command = await project.run('echo command > fault.txt').completion;
        return {
          file,
          command: Reflect.get(sdk, 'sandboxErrorKind')?.(command.error),
          effects: command.effects,
          content: await project.fs.readFile('fault.txt', 'utf8'),
        };
      } finally {
        sandbox.dispose();
      }
    },
    { root, nativeReplicaProbeSource },
  );
  expect(value).toEqual({
    file: 'persistence',
    command: 'persistence',
    effects: { applied: 'yes', persistence: 'failed' },
    content: 'command\n',
  });
});
