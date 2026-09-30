import { execFileSync } from 'node:child_process';
import { nativeReplicaProbeSource } from './fixtures/native-replica-page.ts';
import { initialManifest, installRegistry, saveCases } from './fixtures/npm-install-registry.ts';
import { expect, test } from './fixtures/test.ts';

const root = process.cwd().replaceAll('\\', '/');
let registry: Awaited<ReturnType<typeof installRegistry>>;
test.beforeAll(async () => {
  registry = await installRegistry();
  console.log(
    `[npm reference] ${process.version}; npm${execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()}`,
  );
});
test.afterAll(async () => {
  await registry.close();
});

for (const [index, scenario] of saveCases.entries()) {
  test(`shell install matches native npm manifest and locked versions: case ${index}`, async ({
    page,
  }) => {
    const reference = await registry.native(scenario.args, scenario.initial);
    await page.goto('/no-coi-harness.html');
    const observed = await page.evaluate(
      async ({ root, registryUrl, scenario, initialManifest }) => {
        const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await sdk.createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          storage: { persistence: 'required', namespace: 'agent-install' },
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
            registryUrl,
          },
        });
        try {
          const project = sandbox.project({ root: '/project' });
          await project.fs.writeFile(
            'package.json',
            JSON.stringify({ ...initialManifest, ...scenario.initial }),
          );
          const command = `npm install ${scenario.args.map((arg: string) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ')}`;
          const outcome = await project.run(command).completion;
          const pkg = JSON.parse(await project.fs.readFile('package.json', 'utf8'));
          const lock = await project.fs
            .readFile('package-lock.json', 'utf8')
            .then(JSON.parse, () => null);
          const installed = await project.fs
            .readFile('node_modules/ms/package.json', 'utf8')
            .then(JSON.parse, () => null);
          await project.fs.writeFile('use.cjs', "console.log(require('ms')('2 days'));");
          const used = await project.run('node use.cjs').completion;
          await sandbox.restart({ preview: { src: '' } });
          const reopened = await sandbox.project({ root: '/project' }).run('node use.cjs')
            .completion;
          const readonly = !Reflect.set(sandbox.toolchain, 'registryConnected', false);
          return {
            connected: sandbox.toolchain.registryConnected,
            readonly,
            outcome,
            state: {
              pkg,
              lockDependencies: lock?.packages['']?.dependencies,
              lockDevDependencies: lock?.packages['']?.devDependencies,
              installedVersion: installed?.version,
            },
            used,
            reopened,
          };
        } finally {
          sandbox.dispose();
        }
      },
      { root, registryUrl: registry.origin, scenario, initialManifest },
    );
    expect(observed.outcome).toMatchObject({ status: 'exited', exitCode: 0, worker: 'retained' });
    expect(observed.connected).toBe(true);
    expect(observed.readonly).toBe(true);
    expect(observed.state).toEqual(reference);
    expect(observed.used).toMatchObject({ exitCode: 0, stdout: '172800000\n' });
    expect(observed.reopened).toMatchObject({ exitCode: 0, stdout: '172800000\n' });
  });
}

test('real Pi shell installs and executes a dependency with truthful configured prompt', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(
    async ({ root, registryUrl }) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const { createAgentSession, createSandboxAgentHost } = await import(
        `/@fs${root}/packages/agent/src/index.ts`
      );
      const { modelCatalog } = await import(
        `/@fs${root}/tests/integration/fixtures/workbench-vite-consumer/src/agent-catalog.ts`
      );
      const { scriptedProvider } = await import(
        `/@fs${root}/tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts`
      );
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        storage: { persistence: 'ephemeral' },
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          registryUrl,
        },
      });
      await sandbox.fs.writeFile(
        '/project/package.json',
        '{"name":"agent-project","version":"1.0.0"}',
      );
      await sandbox.fs.writeFile('/project/use.cjs', "console.log(require('ms')('2 days'));");
      const provider = scriptedProvider([
        [{ name: 'shell', args: { command: 'npm install ms && node use.cjs' } }],
        'Installed and verified.',
      ]);
      const agent = createAgentSession({
        host: createSandboxAgentHost({
          sandbox,
          project: { root: '/project' },
          mode: () => 'commands',
        }),
        ...modelCatalog(undefined, provider.fetch),
      });
      try {
        await agent.send('Add ms and run the program.');
        return { trace: await agent.exportTrace(), requests: provider.requests };
      } finally {
        await agent.dispose();
        sandbox.dispose();
      }
    },
    { root, registryUrl: registry.origin },
  );
  const tool = value.trace.transcript.find(
    (entry: { role: string }) => entry.role === 'toolResult',
  );
  expect(tool?.isError).toBe(false);
  expect(JSON.stringify(tool?.content)).toContain('172800000');
  const prompt = JSON.stringify(value.requests[0]?.body.messages[0]);
  expect(prompt).toMatch(/npm install.*configured registry/i);
  expect(prompt).not.toContain(registry.origin);
  expect(prompt).not.toContain('dependency policy belong to the host');
});

test('no registry is a valid connection state; per-call host install does not silently connect shell', async ({
  page,
}) => {
  const beforeRequests = registry.requests.length;
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(
    async ({ root, registryUrl }) => {
      const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const { createSandboxAgentHost } = await import(`/@fs${root}/packages/agent/src/index.ts`);
      const sandbox = await sdk.createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        storage: { persistence: 'ephemeral' },
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      try {
        const project = sandbox.project({ root: '/project' });
        const manifest = '{"name":"unconnected","version":"1.0.0","dependencies":{"ms":"2.0.0"}}';
        await project.fs.writeFile('package.json', manifest);
        const missing = await project.run('npm install ms').completion;
        const before = {
          pkg: await project.fs.readFile('package.json', 'utf8'),
          files: await project.fs.readdir('.'),
        };
        await sandbox.toolchain.install({ cwd: '/project', registryUrl });
        const afterOverride = await project.run('npm install ms').completion;
        const recovered = await project.run('npm install ms || echo recovered').completion;
        const host = createSandboxAgentHost({
          sandbox,
          project: { root: '/project' },
          mode: () => 'commands',
        });
        return {
          missing,
          kind: sdk.sandboxErrorKind(missing.error),
          before,
          manifest,
          connected: Reflect.get(sandbox.toolchain, 'registryConnected'),
          afterKind: sdk.sandboxErrorKind(afterOverride.error),
          recovered,
          notes: host.capabilities().notes,
        };
      } finally {
        sandbox.dispose();
      }
    },
    { root, registryUrl: registry.origin },
  );
  expect(value.kind).toBe('registry-missing');
  expect(value.afterKind).toBe('registry-missing');
  expect(value.missing.effects.applied).toBe('no');
  expect(value.before.pkg).toBe(value.manifest);
  expect(value.before.files.map((entry: { name: string }) => entry.name)).toEqual(['package.json']);
  expect(value.connected).toBe(false);
  expect(registry.requests.slice(beforeRequests)).toEqual(['/ms', '/ms/-/ms-2.0.0.tgz']);
  expect(value.recovered).toMatchObject({ status: 'exited', exitCode: 0, stdout: 'recovered\n' });
  expect(value.notes.join('\n')).toMatch(/no registry.*connected/i);
});

test('install shares busy admission and Stop settles the real held registry request', async ({
  page,
}) => {
  let entered!: () => void;
  const requested = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  registry.hold(async (path) => {
    if (path === '/ms') {
      entered();
      await held;
    }
  });
  await page.goto('/no-coi-harness.html');
  try {
    await page.evaluate(
      async ({ root, registryUrl }) => {
        const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await sdk.createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          storage: { persistence: 'required', namespace: 'install-stop' },
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
            registryUrl,
          },
        });
        await sandbox.fs.writeFile('/project/package.json', '{"name":"held","version":"1.0.0"}');
        Reflect.set(globalThis, 'installSandbox', sandbox);
        Reflect.set(
          globalThis,
          'installRun',
          sandbox.project({ root: '/project' }).run('npm install ms'),
        );
      },
      { root, registryUrl: registry.origin },
    );
    await Promise.race([
      requested,
      page
        .evaluate(() => Reflect.get(globalThis, 'installRun').completion)
        .then((value) => {
          throw new Error(`Install settled before registry: ${JSON.stringify(value)}`);
        }),
    ]);
    const observed = await page.evaluate(
      async ({ root, registryUrl }) => {
        const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = Reflect.get(globalThis, 'installSandbox');
        const project = sandbox.project({ root: '/project' });
        const run = await project.run('echo forbidden').completion;
        const file = await project.fs
          .writeFile('forbidden.txt', 'bad')
          .then(() => 'written', sdk.sandboxErrorKind);
        const install = await sandbox.toolchain
          .install({ cwd: '/project', registryUrl })
          .then(() => 'installed', sdk.sandboxErrorKind);
        const stopped = await Reflect.get(globalThis, 'installRun').stop();
        const manifest = await project.fs.readFile('package.json', 'utf8');
        const next = await project.run('echo next').completion;
        return { run: sdk.sandboxErrorKind(run.error), file, install, stopped, manifest, next };
      },
      { root, registryUrl: registry.origin },
    );
    expect(observed).toMatchObject({
      run: 'busy',
      file: 'busy',
      install: 'busy',
      stopped: { status: 'cancelled', worker: 'retained' },
      manifest: '{"name":"held","version":"1.0.0"}',
      next: { exitCode: 0, stdout: 'next\n' },
    });
  } finally {
    release();
    registry.hold();
    await page.evaluate(() => Reflect.get(globalThis, 'installSandbox')?.dispose());
  }
});

test('readonly install refuses before mutation or fetch; network failure restores manifest', async ({
  page,
}) => {
  const beforeRequests = registry.requests.length;
  await page.goto('/no-coi-harness.html');
  const denied = await page.evaluate(
    async ({ root, registryUrl }) => {
      const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const options = {
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        storage: { persistence: 'ephemeral' },
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          registryUrl,
        },
      };
      const opening = sdk.createSandbox(options);
      options.toolchain.registryUrl = '/must-not-use-mutated-connection';
      const sandbox = await opening;
      Reflect.set(globalThis, 'readonlyInstallSandbox', sandbox);
      const manifest = '{"name":"readonly","version":"1.0.0"}';
      await sandbox.fs.writeFile('/project/package.json', manifest);
      const result = await sandbox
        .project({ root: '/project', readonlyPaths: ['node_modules'] })
        .run('npm install ms').completion;
      return {
        result,
        manifest: await sandbox.fs.readFile('/project/package.json', 'utf8'),
        entries: await sandbox.fs.readdir('/project'),
      };
    },
    { root, registryUrl: registry.origin },
  );
  try {
    expect(denied.result.stderr).toMatch(/EROFS|readonly/i);
    expect(denied.result.effects.applied).toBe('no');
    expect(denied.manifest).toBe('{"name":"readonly","version":"1.0.0"}');
    expect(denied.entries.map((entry: { name: string }) => entry.name)).toEqual(['package.json']);
    expect(registry.requests).toHaveLength(beforeRequests);
    const recovered = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, 'readonlyInstallSandbox');
      const project = sandbox.project({ root: '/project' });
      const failure = await project.run('npm install missing-package').completion;
      const manifest = await project.fs.readFile('package.json', 'utf8');
      await sandbox.restart({ preview: { src: '' } });
      const success = await project.run('npm install ms').completion;
      const version = await project.fs
        .readFile('node_modules/ms/package.json', 'utf8')
        .then(JSON.parse, () => null);
      return { failure, manifest, success, version };
    });
    expect(recovered.failure.exitCode).not.toBe(0);
    expect(recovered.manifest).toBe(denied.manifest);
    expect(recovered.success).toMatchObject({ exitCode: 0 });
    expect(recovered.version?.version).toBe('2.1.3');
  } finally {
    await page.evaluate(() => Reflect.get(globalThis, 'readonlyInstallSandbox')?.dispose());
  }
});

test('native install persistence failure stays untrusted and explicit retry recovers', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(
    async ({ root, registryUrl, nativeReplicaProbeSource }) => {
      const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const sandbox = await sdk.createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        storage: { persistence: 'required', namespace: 'install-quota' },
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          registryUrl,
        },
      });
      try {
        const project = sandbox.project({ root: '/project' });
        await project.fs.writeFile('package.json', '{"name":"quota","version":"1.0.0"}');
        await project.fs.writeFile('source.txt', 'keep');
        const patched = await sandbox.runtime.eval(`${nativeReplicaProbeSource}
observeNativeReplicaWrites(records => { if (records.some(record => record.kind === 'file' && record.path === '/project/node_modules/ms/index.js')) throw new DOMException('install quota probe', 'QuotaExceededError'); });`);
        if (!patched.ok) throw new Error('Native quota boundary failed');
        const failure = await project.run('npm install ms').completion;
        const stamp = await project.fs
          .readFile('node_modules/.rifty-install-stamp.json', 'utf8')
          .then(JSON.parse, () => null);
        await sandbox.restart({ preview: { src: '' } });
        const source = await project.fs.readFile('source.txt', 'utf8');
        const recovered = await project.run('npm install ms').completion;
        return { failure, kind: sdk.sandboxErrorKind(failure.error), stamp, source, recovered };
      } finally {
        sandbox.dispose();
      }
    },
    { root, registryUrl: registry.origin, nativeReplicaProbeSource },
  );
  expect(value.kind).toBe('persistence');
  expect(value.failure.effects).toMatchObject({ persistence: 'failed' });
  // prepareTreeMutation removes the pending marker before the first package write.
  expect(value.stamp).toBeNull();
  expect(value.source).toBe('keep');
  expect(value.recovered).toMatchObject({ status: 'exited', exitCode: 0 });
});
