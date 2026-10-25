import { type Page, expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import {
  type MessagePortRefCase,
  portRows,
  refcountIsolationCase,
  runNodeOracle,
  runOwnerCommand,
  transferCeilingCase,
  transferCeilingRows,
} from './fixtures/message-port-ref-cases.ts';

async function runInOwner(
  page: Page,
  fixture: MessagePortRefCase,
  deadlineMs: number,
): Promise<{ readonly timedOut: boolean; readonly exit: number | null; readonly out: string }> {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: `bu-port-ref-${fixture.name}`,
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    await writeOwnerFile(page, '/scratch/main.cjs', fixture.source);
    return await runOwnerCommand(page, 'node main.cjs', deadlineMs);
  } finally {
    await closeOwner(page);
  }
}

// Fault class: torn-state. Redundant ref/unref/close calls on one port never add
// a second hold and never release another handle's hold (ADR-0447 fault row 1).
test('one port contributes exactly zero or one keepalive hold', async ({ page }) => {
  const oracle = await runNodeOracle(refcountIsolationCase.source);
  expect(oracle.code, oracle.stderr).toBe(0);
  const run = await runInOwner(page, refcountIsolationCase, 10_000);
  expect(run.timedOut, run.out).toBe(false);
  expect(portRows(run.out), run.out).toEqual(portRows(oracle.stdout));
  expect(run.exit, run.out).toBe(oracle.code);
});

// Fault class: provenance-lie. After a transfer, the release is not observable,
// so it is refused before anything detaches, at every entry point. A referenced
// port keeps its peer and keeps holding the program (ADR-0447 fault rows 2-3).
test('transfers that would hide a referenced port release fail by name', async ({ page }) => {
  const run = await runInOwner(page, transferCeilingCase, 10_000);
  expect(run.timedOut, run.out).toBe(false);
  expect(portRows(run.out), run.out).toEqual(transferCeilingRows);
  expect(run.exit, run.out).toBe(0);
});
