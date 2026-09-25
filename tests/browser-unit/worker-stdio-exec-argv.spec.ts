import { type Page, expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import { runOwnerCommand } from './fixtures/message-port-ref-cases.ts';
import {
  type StartupProgram,
  runStartupProgramInNode,
  startupPrograms,
  startupRows,
} from './fixtures/worker-stdio-exec-argv-cases.ts';

// ADR-0449 in a real Chromium child realm (`node main.cjs` / `node -e …` in the
// project terminal), against a live Node run of the same sources: a Worker's
// output reaches the terminal, nested Workers and forks inherit startup options
// as in Node, a fork from an eval parent drops the eval pair, and vitest
// 4.1.11's pool shapes start their entries with the pool `execArgv`.

interface ProgramRun {
  readonly name: string;
  readonly timedOut: boolean;
  readonly exit: number | null;
  readonly rows: readonly string[];
}

async function runInRifty(page: Page, program: StartupProgram): Promise<ProgramRun> {
  const directory = `sx-${program.name}`;
  for (const [name, content] of Object.entries(program.files)) {
    await writeOwnerFile(page, `/scratch/${directory}/${name}`, content);
  }
  const run = await runOwnerCommand(
    page,
    `cd ${directory} && ${program.command ?? 'node main.cjs'}`,
    60_000,
  );
  return { name: program.name, timedOut: run.timedOut, exit: run.exit, rows: startupRows(run.out) };
}

test('Worker stdio and fork/Worker startup options match live Node (Chromium child realm)', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const expected: ProgramRun[] = [];
  for (const program of startupPrograms) {
    const oracle = await runStartupProgramInNode(program);
    expected.push({
      name: program.name,
      timedOut: false,
      exit: oracle.code,
      rows: startupRows(oracle.stdout),
    });
  }

  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-worker-stdio-exec-argv',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    // `node` needs the package-tree readiness stamp that an install publishes.
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    const actual: ProgramRun[] = [];
    for (const program of startupPrograms) actual.push(await runInRifty(page, program));
    expect(actual).toEqual(expected);
  } finally {
    await closeOwner(page);
  }
});
