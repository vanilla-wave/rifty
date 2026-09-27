import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';
import { workerStartupOptionsCases } from './fixtures/worker-startup-options-cases.ts';
import { nativeWorkerStartupOptions } from './fixtures/worker-startup-options-oracle.ts';

for (const fixture of workerStartupOptionsCases) {
  test(`Worker startup options: ${fixture.name}`, async ({ page }) => {
    const oracle = await nativeWorkerStartupOptions(fixture);
    expect(oracle.code, oracle.stderr).toBe(0);
    expect(oracle.stderr).toBe('');
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-worker-options-${fixture.name}`,
      hiddenEmptyBoot: true,
      persistence: 'ephemeral',
    });
    try {
      for (const [path, source] of Object.entries({ ...fixture.files, 'main.cjs': fixture.parent }))
        await writeOwnerFile(page, `/scratch/${path}`, source);
      const result = await page.evaluate(async (fixtureUrl) => {
        const module = await import(/* @vite-ignore */ fixtureUrl);
        const terminal = module.currentProject().terminals.open();
        let output = '';
        const detach = terminal.attach((chunk: string) => {
          output += chunk;
        });
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          const run = terminal.run('node main.cjs');
          const exit = await Promise.race([
            run.exited,
            new Promise<null>((resolve) => {
              deadline = setTimeout(() => resolve(null), 10000);
            }),
          ]);
          return { exit, output, coi: crossOriginIsolated };
        } finally {
          if (deadline !== undefined) clearTimeout(deadline);
          detach();
          await terminal.close();
        }
      }, sealedWorkbenchFixtureUrl);
      expect(result.coi).toBe(true);
      expect(result.exit, result.output).toEqual({ code: oracle.code, signal: null });
      expect(result.output).not.toContain('[rifty:worker_threads] Falling back');
      const rows = (text: string) =>
        text
          .replaceAll('\r', '')
          .split('\n')
          .filter((line) => line.startsWith('OPTIONS|'));
      expect(rows(result.output)).toEqual(rows(oracle.stdout));
    } finally {
      await closeOwner(page);
    }
  });
}
