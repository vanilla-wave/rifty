import { type Page, expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import { type AdvancedIpcProgram, runNodeProgram } from './fixtures/advanced-ipc-cases.ts';
import { runOwnerCommand } from './fixtures/message-port-ref-cases.ts';
import {
  failedStartPrograms,
  workerHandlePrograms,
  workerRows,
} from './fixtures/worker-handle-keepalive-cases.ts';

// ADR-0446 / goal I2: a live worker_threads.Worker holds its parent, an
// unref()'d one does not, and a worker realm exits when its loop drains — in a
// real Chromium child realm (`node main.cjs`), against a live Node run of the
// same sources. One owner runs every program so the diff shows them all.

interface ProgramRun {
  readonly name: string;
  readonly timedOut: boolean;
  readonly exit: number | null;
  readonly rows: readonly string[];
}

async function runInRifty(page: Page, program: AdvancedIpcProgram): Promise<ProgramRun> {
  const directory = `/scratch/wt-${program.name}`;
  for (const [name, content] of Object.entries(program.files)) {
    await writeOwnerFile(page, `${directory}/${name}`, content);
  }
  await writeOwnerFile(page, `${directory}/main.cjs`, program.main);
  const run = await runOwnerCommand(page, `cd wt-${program.name} && node main.cjs`, 60_000);
  return { name: program.name, timedOut: run.timedOut, exit: run.exit, rows: workerRows(run.out) };
}

test('Worker lifetime holds the parent as in live Node (Chromium child realm)', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const expected: ProgramRun[] = [];
  for (const program of workerHandlePrograms) {
    const oracle = await runNodeProgram(program);
    expect(oracle.stderr, program.name).toBe('');
    expected.push({
      name: program.name,
      timedOut: false,
      exit: oracle.code,
      rows: workerRows(oracle.stdout),
    });
  }
  const expectedFailedStarts: ProgramRun[] = [];
  for (const { node } of failedStartPrograms) {
    const oracle = await runNodeProgram(node);
    expectedFailedStarts.push({
      name: node.name,
      timedOut: false,
      exit: oracle.code,
      rows: workerRows(oracle.stdout),
    });
  }

  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-worker-handle-keepalive',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    // `node` needs the package-tree readiness stamp that an install publishes.
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    const actual: ProgramRun[] = [];
    for (const program of workerHandlePrograms) actual.push(await runInRifty(page, program));
    const actualFailedStarts: ProgramRun[] = [];
    for (const { rifty } of failedStartPrograms) {
      actualFailedStarts.push(await runInRifty(page, rifty));
    }
    expect({ actual, actualFailedStarts }).toEqual({
      actual: expected,
      actualFailedStarts: expectedFailedStarts,
    });
  } finally {
    await closeOwner(page);
  }
});
