import { expect, test } from '@playwright/test';
import { runInNode } from '../../tools/node-parity-runner/src/run-in-node.ts';
import {
  bootOwner,
  closeOwner,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';
import { evalForkCase, evalForkChild, evalForkSource } from './fixtures/eval-fork-options-case.ts';

function rows(text: string, prefix: string): Record<string, unknown>[] {
  return text
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => JSON.parse(line.slice(prefix.length)) as Record<string, unknown>);
}

for (const flag of ['-e', '-p'] as const) {
  test(`fork preserves ${flag} parent's native identity filter and eval descriptor`, async ({
    page,
  }) => {
    const [native] = JSON.parse(await runInNode(evalForkCase(flag))) as {
      code: number;
      stdout: string;
      stderr: string;
    }[];
    expect(native?.code, native?.stderr).toBe(0);
    const expected = rows(native?.stdout ?? '', 'RESULT|');
    expect(rows(native?.stdout ?? '', 'META|')).toEqual([
      {
        own: true,
        matches: true,
        writable: false,
        enumerable: true,
        configurable: true,
        assignmentRetains: true,
        assignmentError: null,
      },
    ]);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `eval-fork-${flag.slice(1)}`,
      hiddenEmptyBoot: true,
      persistence: 'ephemeral',
    });
    try {
      await writeOwnerFile(page, '/scratch/child.cjs', evalForkChild);
      const command = `node ${flag} '${evalForkSource.replaceAll("'", "'\\''")}'`;
      const result = await page.evaluate(
        async ({ url, command }) => {
          const fixture = await import(/* @vite-ignore */ url);
          const terminal = fixture.currentProject().terminals.open();
          let output = '';
          const detach = terminal.attach((chunk: string) => {
            output += chunk;
          });
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const run = terminal.run(command);
            const exit = await Promise.race([
              run.exited,
              new Promise<null>((resolve) => {
                timer = setTimeout(() => resolve(null), 10000);
              }),
            ]);
            return { exit, output, coi: crossOriginIsolated };
          } finally {
            if (timer !== undefined) clearTimeout(timer);
            detach();
            await terminal.close();
          }
        },
        { url: sealedWorkbenchFixtureUrl, command },
      );
      expect(result.coi).toBe(true);
      expect(result.exit, result.output).toEqual({ code: 0, signal: null });
      expect(rows(result.output, 'META|')).toEqual(rows(native?.stdout ?? '', 'META|'));
      const actual = rows(result.output, 'RESULT|');
      for (const mode of ['default', 'empty', 'same-array']) {
        const oracle = expected.find((row) => row.mode === mode);
        expect(oracle).toEqual({
          mode,
          unchanged: true,
          code: 0,
          stdout: 'FILE|{"argv":[],"evalOwn":false}\n',
          stderr: '',
        });
        expect(actual.find((row) => row.mode === mode)).toEqual(oracle);
      }
      // These retain source-bearing eval argv in Node. Rifty's existing ceiling stays explicit.
      for (const mode of ['cloned-array', 'unmatched-eval', 'last-match']) {
        const oracle = expected.find((row) => row.mode === mode);
        expect(oracle).toMatchObject({ mode, unchanged: true, code: 0 });
        expect(String(oracle?.stdout)).toMatch(/^INLINE\|/);
        expect(actual.find((row) => row.mode === mode)).toEqual({
          mode,
          unchanged: true,
          thrown: { name: 'NotImplementedError', feature: 'child_process.fork.execArgv' },
        });
      }
    } finally {
      await closeOwner(page);
    }
  });
}
