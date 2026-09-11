import { expect, test } from '@playwright/test';

const root = process.cwd().replaceAll('\\', '/');
const scenarioPath =
  '/tests/integration/fixtures/no-coi-packed-toolchain-consumer/src/agent-scenarios.ts';

test('Stop retains an applied mutation through the pending native flush', async ({ page }) => {
  test.setTimeout(120_000);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const request = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**/agent-flush-barrier', async (route) => {
    requested();
    await held;
    await route.fulfill({ status: 200, body: 'released' });
  });
  await page.goto('/no-coi-harness.html');
  try {
    await page.evaluate(async (root) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      Reflect.set(globalThis, 'agentFaultSandbox', sandbox);
      if (typeof sandbox.project !== 'function')
        throw new Error('Missing public sandbox.project method');
      await sandbox.fs.writeFile('/mutation/seed', 'seed');
      const patched = await sandbox.runtime.eval(`
        const nativeWritable = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = async function (...args) {
          if (this.name === 'held.txt') await fetch('/agent-flush-barrier');
          return Reflect.apply(nativeWritable, this, args);
        };
      `);
      if (!patched.ok) throw new Error('native boundary injection failed');
      const project = sandbox.project({ root: '/mutation' });
      const run = project.run('echo applied > held.txt');
      Reflect.set(globalThis, 'agentFaultRun', run);
      Reflect.set(globalThis, 'agentFaultSettled', false);
      run.completion.then(() => Reflect.set(globalThis, 'agentFaultSettled', true));
    }, root);
    await request;
    await page.evaluate(() => {
      void Reflect.get(globalThis, 'agentFaultRun').stop();
    });
    expect(await page.evaluate(() => Reflect.get(globalThis, 'agentFaultSettled'))).toBe(false);
    release();
    const observed = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, 'agentFaultSandbox');
      const result = await Reflect.get(globalThis, 'agentFaultRun').completion;
      const content = await sandbox.fs.readFile('/mutation/held.txt', 'utf8');
      const next = await sandbox.project({ root: '/mutation' }).run('echo next').completion;
      return { result, content, next };
    });
    expect(observed).toMatchObject({
      result: {
        status: 'cancelled',
        worker: 'retained',
        effects: { applied: 'yes', persistence: 'flushed' },
      },
      content: 'applied\n',
      next: { status: 'exited', stdout: 'next\n' },
    });
  } finally {
    release();
    await page.evaluate(() => Reflect.get(globalThis, 'agentFaultSandbox')?.dispose());
  }
});

test('project mutation and command report a native OPFS write failure', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/no-coi-harness.html');
  const observed = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      toolchain: {
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      },
    });
    try {
      if (typeof sandbox.project !== 'function')
        throw new Error('Missing public sandbox.project method');
      await sandbox.fs.writeFile('/quota/seed', 'seed');
      await sandbox.runtime.eval(`
        const nativeWritable = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = function (...args) {
          if (this.name === 'fault.txt') return Promise.reject(new DOMException('agent quota fault', 'QuotaExceededError'));
          return Reflect.apply(nativeWritable, this, args);
        };
      `);
      const project = sandbox.project({ root: '/quota' });
      let fileError: { name: string; effects?: unknown } | undefined;
      try {
        await project.fs.writeFile('fault.txt', 'file');
      } catch (error) {
        const e = error as Error & { effects?: unknown };
        fileError = { name: e.name, effects: e.effects };
      }
      const command = await project.run('echo command > fault.txt').completion;
      const content = await project.fs.readFile('fault.txt', 'utf8');
      return { fileError, command, content };
    } finally {
      sandbox.dispose();
    }
  }, root);
  expect(observed.fileError).toMatchObject({
    name: 'SandboxPersistenceError',
    effects: { applied: 'yes', persistence: 'failed' },
  });
  expect(observed.command).toMatchObject({
    status: 'failed',
    effects: { applied: 'yes', persistence: 'failed' },
  });
  expect(observed.content).toBe('command\n');
});

for (const scenario of [
  'agentFilesScenario',
  'agentCommandsScenario',
  'agentStopScenario',
] as const) {
  test(`${scenario}: public no-COI SDK`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/no-coi-harness.html');
    const result = await page.evaluate(
      async ({ root, scenario, scenarioPath }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          },
        });
        try {
          if (typeof sandbox.project !== 'function')
            throw new Error('Missing public sandbox.project method');
          const scenarios = await import(`/@fs${root}${scenarioPath}`);
          return { coi: crossOriginIsolated, result: await scenarios[scenario](sandbox) };
        } finally {
          sandbox.dispose();
        }
      },
      { root, scenario, scenarioPath },
    );
    expect(result.coi).toBe(false);
    const observed = result.result;
    if (scenario === 'agentFilesScenario') {
      expect(observed).toMatchObject({
        content: 'hello',
        raw: 'hello',
        retained: 'keep',
        rawAnchored: 'root',
        stat: { isFile: true, size: 5 },
      });
      expect(observed.list).toEqual([{ name: 'a.txt', isDirectory: false, isFile: true }]);
      for (const key of ['mkdir', 'rename', 'rm'])
        expect(observed[key]).toMatchObject({ applied: 'yes', persistence: 'flushed' });
      for (const key of ['denied', 'deniedMove'])
        expect(observed[key]).toMatchObject({ code: 'EROFS' });
      for (const key of ['missing', 'removed'])
        expect(observed[key]).toMatchObject({ code: 'ENOENT' });
    } else if (scenario === 'agentCommandsScenario') {
      expect(observed.first).toMatchObject({
        status: 'exited',
        exitCode: 0,
        stdout: '/commands/src\n',
      });
      expect(observed.next).toMatchObject({ status: 'exited', stdout: '/commands\n\n' });
      expect(observed.failed.exitCode).not.toBe(0);
      expect(observed.afterFailed.stdout).toBe('/commands\n');
      expect(observed.output).toMatchObject({ status: 'exited', stdout: 'AC', stderr: 'B' });
      expect(observed.events).toEqual(['stdout:A', 'stderr:B', 'stdout:C', 'complete']);
      for (const key of ['guestDenied', 'redirectDenied', 'background', 'executionDenied'])
        expect(observed[key].exitCode).not.toBe(0);
      expect(observed.backgroundFile).toMatchObject({ code: 'ENOENT' });
      expect(observed.forbidden).toMatchObject({ code: 'ENOENT' });
      expect(observed).toMatchObject({
        retained: 'keep',
        effect: 'saved\n',
        built: 'built\n',
        npm: { exitCode: 0 },
      });
    } else {
      expect(observed.overlap).toMatchObject({
        status: 'failed',
        error: { name: 'SandboxToolchainBusyError' },
      });
      expect(observed.stopped).toMatchObject({
        status: 'cancelled',
        worker: 'retained',
        effects: { persistence: 'flushed' },
      });
      expect(observed).toMatchObject({
        same: true,
        effect: 'applied\n',
        next: { stdout: '/stop\nnext\n' },
      });
      expect(observed.old).toMatchObject({ status: 'exited', exitCode: 0, stdout: '' });
      expect(observed.currentStopped).toMatchObject({
        status: 'cancelled',
        worker: 'retained',
        stdout: 'current-entered\ncurrent-stopped\n',
      });
      expect(observed.oldEffect).toMatchObject({ code: 'ENOENT' });
      expect(observed.terminated).toMatchObject({
        status: 'cancelled',
        worker: 'replaced',
        effects: { applied: 'unknown', persistence: 'unknown' },
      });
      expect(observed.afterHard).toMatchObject({
        status: 'exited',
        exitCode: 0,
        stdout: 'after-hard\n',
      });
    }
  });
}
