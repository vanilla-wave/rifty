import { expect, test } from '@playwright/test';
import { runInNode } from '../../tools/node-parity-runner/src/run-in-node.ts';
import {
  bootOwner,
  closeOwner,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';
import { forkStartupOptionsCase as fixture } from './fixtures/fork-startup-options-case.ts';

test('fork applies execArgv preloads, conditions and import.meta.resolve parent before entry', async ({
  page,
}) => {
  const oracle = await runInNode(fixture);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-fork-startup-options',
    hiddenEmptyBoot: true,
    persistence: 'ephemeral',
  });
  try {
    for (const [path, source] of Object.entries(fixture.setup?.files ?? {}))
      await writeOwnerFile(page, `/${path}`, source);
    await writeOwnerFile(page, '/scratch/main.cjs', fixture.code);
    const result = await page.evaluate(async (fixtureUrl) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      const terminal = fixture.currentProject().terminals.open();
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
    expect(result.exit, result.output).toEqual({ code: 0, signal: null });
    const rows = (text: string) =>
      text
        .replaceAll('\r', '')
        .split('\n')
        .filter((line) => line.startsWith('FORK_OPTIONS|'));
    expect(rows(result.output)).toEqual(rows(oracle));
  } finally {
    await closeOwner(page);
  }
});
