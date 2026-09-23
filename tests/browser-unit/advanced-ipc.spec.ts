import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import {
  type AdvancedIpcProgram,
  ceilingProgram,
  ceilingRows,
  parityPrograms,
  programRows,
  runNodeProgram,
} from './fixtures/advanced-ipc-cases.ts';
import { runOwnerCommand } from './fixtures/message-port-ref-cases.ts';

// ADR-0448: fork's `serialization: 'advanced'` in a real Chromium child realm
// (Chromium's own structured clone, DataCloneError text, SharedArrayBuffer and
// platform objects), against a live Node run of the same source.

async function runInRifty(
  page: Parameters<typeof gotoHarness>[0],
  program: AdvancedIpcProgram,
): Promise<{ readonly timedOut: boolean; readonly exit: number | null; readonly out: string }> {
  const directory = `/scratch/ipc-${program.name}`;
  for (const [name, content] of Object.entries(program.files)) {
    await writeOwnerFile(page, `${directory}/${name}`, content);
  }
  await writeOwnerFile(page, `${directory}/main.cjs`, program.main);
  return runOwnerCommand(page, `cd ipc-${program.name} && node main.cjs`, 60_000);
}

async function withOwner(
  page: Parameters<typeof gotoHarness>[0],
  name: string,
  run: () => Promise<void>,
): Promise<void> {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: `bu-advanced-ipc-${name}`,
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    // `node` needs the package-tree readiness stamp that an install publishes.
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    await run();
  } finally {
    await closeOwner(page);
  }
}

for (const program of parityPrograms) {
  test(`advanced fork IPC in a Chromium child realm matches live Node: ${program.name}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const oracle = await runNodeProgram(program);
    expect(oracle.code, oracle.stderr).toBe(0);
    const nodeRows = programRows(oracle.stdout, () => true);
    const labels = new Set(nodeRows.map((line) => line.split(' ', 1)[0]));
    const keep = (line: string): boolean =>
      line.startsWith('case-error:') || labels.has(line.split(' ', 1)[0] ?? '');

    await withOwner(page, program.name, async () => {
      const run = await runInRifty(page, program);
      expect(run.timedOut, run.out).toBe(false);
      expect(programRows(run.out, keep), run.out).toEqual(nodeRows);
      expect(run.exit, run.out).toBe(oracle.code);
    });
  });
}

test('Chromium platform objects in an advanced message fail by name', async ({ page }) => {
  test.setTimeout(180_000);
  const oracle = await runNodeProgram(ceilingProgram);
  const isRow = (line: string): boolean => line.startsWith('CEIL|');
  // Node's v8 serializer writes each value as a plain object: a gap, not parity.
  expect(programRows(oracle.stdout, isRow), oracle.stderr).toEqual([
    ...ceilingRows.slice(0, -1).map((row) => row.replace(/\|[^|]*$/, '|sent')),
    'CEIL|after|true',
  ]);

  await withOwner(page, ceilingProgram.name, async () => {
    const run = await runInRifty(page, ceilingProgram);
    expect(run.timedOut, run.out).toBe(false);
    expect(programRows(run.out, isRow), run.out).toEqual(ceilingRows);
    expect(run.exit, run.out).toBe(0);
  });
});
