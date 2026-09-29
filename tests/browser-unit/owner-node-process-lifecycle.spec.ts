import { stripVTControlCharacters } from 'node:util';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import { runOwnerCommand } from './fixtures/message-port-ref-cases.ts';
import {
  lifecycleRows,
  processLifecycleCases,
  runLifecycleOracle,
} from './fixtures/process-lifecycle-cases.ts';

// ADR-0445 / I3: uncaught/unhandled handlers, the 'exit' event and exit()/exitCode
// on the real Chromium supervised child. Every case runs verbatim in live Node
// (the oracle) and as the same rifty shell line; `L|` rows, status and the loud
// fatal marker must match.
test('Node process lifecycle events and exit status match live Node', async ({ page }) => {
  test.setTimeout(900_000);
  const oracles = new Map<string, Awaited<ReturnType<typeof runLifecycleOracle>>>();
  for (const testCase of processLifecycleCases) {
    const oracle = await runLifecycleOracle(testCase);
    if (testCase.fatal !== undefined) {
      expect(oracle.stderr, `${testCase.name} oracle stderr`).toContain(testCase.fatal);
    }
    oracles.set(testCase.name, oracle);
  }

  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-process-lifecycle',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  const mismatches: string[] = [];
  try {
    // `node` needs the package-tree readiness stamp that an install publishes.
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    for (const testCase of processLifecycleCases) {
      for (const [path, content] of Object.entries(testCase.files)) {
        await writeOwnerFile(page, `/scratch/${path}`, content);
      }
    }
    for (const testCase of processLifecycleCases) {
      const oracle = oracles.get(testCase.name);
      if (oracle === undefined) throw new Error(`missing oracle for ${testCase.name}`);
      const line = testCase.line ?? `node ${testCase.nodeArgv.join(' ')}`;
      const run = await runOwnerCommand(page, line, 20_000);
      const out = stripVTControlCharacters(run.out);
      const actual = {
        rows: lifecycleRows(out),
        exit: run.timedOut ? 'timeout' : run.exit,
        fatal: testCase.fatal === undefined ? true : out.includes(testCase.fatal),
      };
      const expected = { rows: lifecycleRows(oracle.stdout), exit: oracle.code, fatal: true };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        mismatches.push(
          `${testCase.name}\n  node  ${JSON.stringify(expected)}\n  rifty ${JSON.stringify(actual)}`,
        );
      }
      expect.soft(actual, `${testCase.name} (${oracle.version})\n${out}`).toEqual(expected);
    }
  } finally {
    if (mismatches.length > 0) {
      console.log(`LIFECYCLE-MISMATCHES ${mismatches.length}\n${mismatches.join('\n')}`);
    }
    await closeOwner(page);
  }
});
