import { expect, test } from '@playwright/test';

test('agent project runs and rebuilds installed Vite with its file policy', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/no-coi-harness.html');
  const observed = await page.evaluate(
    async (root) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const { agentInstalledBuildScenario } = await import(
        `/@fs${root}/tests/integration/fixtures/no-coi-packed-toolchain-consumer/src/agent-installed-scenario.ts`
      );
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      try {
        return {
          coi: crossOriginIsolated,
          result: await agentInstalledBuildScenario(sandbox, '/npm-registry'),
        };
      } finally {
        sandbox.dispose();
      }
    },
    process.cwd().replaceAll('\\', '/'),
  );
  expect(observed.coi).toBe(false);
  expect(observed.result.version).toBe('7.3.6');
  for (const result of [observed.result.first, observed.result.rebuild]) {
    expect(result).toMatchObject({
      status: 'exited',
      exitCode: 0,
      worker: 'retained',
      effects: { applied: 'yes', persistence: 'flushed' },
    });
  }
  expect(observed.result.firstOutput.join('\n')).toContain('agent-first-build');
  expect(observed.result.output.join('\n')).toContain('agent-edited-build');
  expect(observed.result.output.join('\n')).not.toContain('agent-first-build');
  expect(observed.result.forbidden.exitCode).not.toBe(0);
  expect(observed.result.retained).toBe('keep');
  expect(observed.result.next).toMatchObject({
    status: 'exited',
    exitCode: 0,
    stdout: '/agent-build\nafter-build\n',
  });
});
