import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';
import {
  workerLifecycleCases,
  workerLifecycleCommand,
  workerLifecycleRows,
} from './fixtures/worker-lifecycle-cases.ts';
import { nativeWorkerLifecycle } from './fixtures/worker-lifecycle-oracle.ts';

for (const fixture of workerLifecycleCases) {
  test(`Worker lifecycle: ${fixture.name}`, async ({ page }) => {
    const oracle = await nativeWorkerLifecycle(fixture);
    expect(oracle.code).toBe(0);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-worker-lifecycle-${fixture.name}`,
      hiddenEmptyBoot: true,
      persistence: 'ephemeral',
    });
    try {
      await writeOwnerFile(page, '/scratch/child.cjs', fixture.child);
      if (fixture.entry !== 'eval')
        await writeOwnerFile(page, `/scratch/${fixture.entry}`, fixture.parent);
      const result = await page.evaluate(
        async ({ fixtureUrl, command }) => {
          const fixture = await import(/* @vite-ignore */ fixtureUrl);
          const terminal = fixture.currentProject().terminals.open();
          let output = '';
          const detach = terminal.attach((chunk: string) => {
            output += chunk;
          });
          const run = terminal.run(command);
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            const outcome = await Promise.race([
              run.exited.then((exit: { code: number | null; signal: string | null }) => ({
                timedOut: false,
                exit,
              })),
              new Promise<{ timedOut: true; exit: null }>((resolve) => {
                timeout = setTimeout(() => resolve({ timedOut: true, exit: null }), 6_000);
              }),
            ]);
            await terminal.close();
            return { ...outcome, output, coi: crossOriginIsolated };
          } finally {
            if (timeout !== undefined) clearTimeout(timeout);
            detach();
            await terminal.close();
          }
        },
        { fixtureUrl: sealedWorkbenchFixtureUrl, command: workerLifecycleCommand(fixture) },
      );
      expect(result.coi).toBe(true);
      expect(result.timedOut, result.output).toBe(false);
      expect(result.exit, result.output).toEqual({ code: oracle.code, signal: null });
      expect(result.output).not.toContain('[rifty:worker_threads] Falling back');
      const stderrRows = workerLifecycleRows(oracle.stderr);
      const rows = workerLifecycleRows(result.output);
      // Terminal multiplexes fds; compare stdout order independently of stderr delivery.
      expect(rows.filter((row) => !stderrRows.includes(row))).toEqual(
        workerLifecycleRows(oracle.stdout),
      );
      expect(rows.filter((row) => stderrRows.includes(row)).sort()).toEqual(stderrRows.sort());
    } finally {
      await closeOwner(page);
    }
  });
}
