import { stripVTControlCharacters } from 'node:util';
import { expect, test } from '@playwright/test';
import fixture from '../../tools/node-parity-runner/cases/child_process/public-ipc-advanced-proxy.case.ts';
import { runInNode } from '../../tools/node-parity-runner/src/run-in-node.ts';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';

test('advanced fork IPC rejects Proxy without traps and keeps nonbinary control/getter semantics', async ({
  page,
}) => {
  const oracle = await runInNode(fixture);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'browser-unit-advanced-ipc-proxy',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    expect((await execLine(page, 'npm install')).exit).toBe(0);
    for (const [path, source] of Object.entries(fixture.setup?.files ?? {})) {
      await writeOwnerFile(page, `/scratch/${path.replace(/^project\//, '')}`, source);
    }
    await writeOwnerFile(page, '/scratch/proxy-parent.cjs', fixture.code);
    const actual = await execLine(page, 'node proxy-parent.cjs');
    expect(actual.exit, actual.out).toBe(0);
    expect(stripVTControlCharacters(actual.out).replaceAll('\r', '').trim()).toBe(oracle.trim());
  } finally {
    await closeOwner(page);
  }
});
