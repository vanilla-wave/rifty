import { expect, test } from './fixtures/test.ts';

const root = process.cwd().replaceAll('\\', '/');

// Fault boundary: owned in-process outcome projection. A recovered install's
// provenance must not replace the last executed command's outcome.
test('later command failures retain their own outcome after a missing registry', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const observed = await page.evaluate(async (root) => {
    const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
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
      await project.fs.writeFile('package.json', '{"name":"registry-outcome","version":"1.0.0"}');
      const outcomes = [];
      for (const command of [
        'node missing.cjs',
        'false',
        'missing-command',
        'cat < missing-input',
        'echo output > missing-directory/output',
        'npm run missing-script',
      ]) {
        const baseline = await project.run(command).completion;
        const recovered = await project.run(`npm install ms || echo recovered; ${command}`)
          .completion;
        outcomes.push({ command, baseline, recovered });
      }
      return outcomes;
    } finally {
      sandbox.dispose();
    }
  }, root);
  for (const { command, baseline, recovered } of observed) {
    expect.soft(baseline.status, command).toBe('exited');
    expect.soft(baseline.exitCode, command).not.toBe(0);
    expect.soft(recovered.status, command).toBe(baseline.status);
    expect.soft(recovered.exitCode, command).toBe(baseline.exitCode);
    expect.soft(recovered.error, command).toBeUndefined();
    expect.soft(recovered.stdout, command).toBe(`recovered\n${baseline.stdout}`);
    expect.soft(recovered.stderr, command).toContain(baseline.stderr);
  }
});

test('registry provenance follows executed branches, nested scripts and the final pipeline stage', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const cases = [
    { command: 'npm install ms', registry: true, exitCode: 1 },
    { command: 'npm install ms && echo skipped', registry: true, exitCode: 1 },
    { command: 'true || npm install ms; false', registry: false, exitCode: 1 },
    {
      command: 'npm install ms || echo recovered; false && echo skipped',
      registry: false,
      exitCode: 1,
    },
    { command: 'npm install ms || echo recovered || false', registry: false, exitCode: 0 },
    { command: 'npm install ms | false', registry: false, exitCode: 1 },
    { command: 'false | npm install ms', registry: true, exitCode: 1 },
    { command: 'npm install ms | cat', registry: false, exitCode: 0 },
    { command: 'npm run nested-missing', registry: true, exitCode: 1 },
    { command: 'npm run nested-recovered; false', registry: false, exitCode: 1 },
    { command: 'npm run nested-broken', registry: false, exitCode: 1 },
    { command: 'npm run phase', registry: false, exitCode: 1 },
    { command: 'npm install ms || npm run missing', registry: true, exitCode: 1 },
  ];
  const observed = await page.evaluate(
    async ({ root, cases }) => {
      const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
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
        await project.fs.writeFile(
          'package.json',
          JSON.stringify({
            name: 'registry-outcome',
            version: '1.0.0',
            scripts: {
              missing: 'npm install ms',
              recovered: 'npm install ms || echo recovered',
              'nested-missing': 'npm run missing',
              'nested-recovered': 'npm run recovered',
              'nested-broken': 'npm run recovered; node missing.cjs',
              prephase: 'npm run recovered',
              phase: 'false',
            },
          }),
        );
        const outcomes = [];
        for (const { command } of cases) {
          const outcome = await project.run(command).completion;
          outcomes.push({ outcome, kind: sdk.sandboxErrorKind(outcome.error) });
        }
        return outcomes;
      } finally {
        sandbox.dispose();
      }
    },
    { root, cases },
  );
  for (const [index, scenario] of cases.entries()) {
    const { outcome, kind } = observed[index]!;
    expect.soft(outcome.exitCode, scenario.command).toBe(scenario.exitCode);
    expect.soft(outcome.status, scenario.command).toBe(scenario.registry ? 'failed' : 'exited');
    expect.soft(kind, scenario.command).toBe(scenario.registry ? 'registry-missing' : undefined);
    if (scenario.registry) {
      expect.soft(outcome.effects.applied, scenario.command).toBe('no');
    } else {
      expect.soft(outcome.error, scenario.command).toBeUndefined();
    }
  }
});

test('Stop after recovered npm preserves cancellation and retains the worker', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/no-coi-harness.html');
  const observed = await page.evaluate(async (root) => {
    const sdk = await import(`/@fs${root}/packages/rifty/src/index.ts`);
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
      await project.fs.writeFile('package.json', '{"name":"registry-stop","version":"1.0.0"}');
      await project.fs.writeFile(
        'wait.cjs',
        `
        const timer = setInterval(() => {}, 1000);
        process.once('SIGINT', () => { clearInterval(timer); console.log('stopped'); });
        console.log('waiting');
      `,
      );
      const run = project.run('npm install ms || echo recovered; node wait.cjs');
      let ready!: () => void;
      const started = new Promise<void>((resolve) => {
        ready = resolve;
      });
      run.onOutput(({ chunk }) => {
        if (chunk.includes('waiting')) ready();
      });
      await Promise.race([
        started,
        run.completion.then((outcome) => {
          throw new Error(`Settled before Stop: ${JSON.stringify(outcome)}`);
        }),
      ]);
      const stopped = await run.stop();
      const completion = await run.completion;
      const next = await project.run('echo next').completion;
      return { stopped, completion, next };
    } finally {
      sandbox.dispose();
    }
  }, root);
  expect(observed.stopped).toMatchObject({
    status: 'cancelled',
    worker: 'retained',
    stdout: 'recovered\nwaiting\nstopped\n',
  });
  expect(observed.stopped.error).toBeUndefined();
  expect(observed.completion).toEqual(observed.stopped);
  expect(observed.next).toMatchObject({ status: 'exited', exitCode: 0, stdout: 'next\n' });
});
