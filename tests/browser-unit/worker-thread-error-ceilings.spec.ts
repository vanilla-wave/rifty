import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import { workerCustomInspectCeilingCase as fixture } from './fixtures/worker-startup-options-cases.ts';
import { nativeWorkerStartupOptions } from './fixtures/worker-startup-options-oracle.ts';

test('Worker fatal custom inspection has a named ceiling and still exits', async ({ page }) => {
  const oracle = await nativeWorkerStartupOptions(fixture);
  expect(oracle.code, oracle.stderr).toBe(0);
  expect(oracle.stdout.trim()).toBe(
    'OPTIONS|[["error","Error","ERR_WORKER_UNSERIALIZABLE_ERROR",null],["exit",1]]',
  );
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-worker-error-custom-ceiling',
    hiddenEmptyBoot: true,
    persistence: 'ephemeral',
  });
  try {
    for (const [path, source] of Object.entries({ ...fixture.files, 'main.cjs': fixture.parent }))
      await writeOwnerFile(page, `/scratch/${path}`, source);
    const result = await execLine(page, 'node main.cjs');
    expect(result.exit, result.out).toBe(0);
    const rows = result.out
      .replaceAll('\r', '')
      .split('\n')
      .filter((row) => row.startsWith('OPTIONS|'));
    expect(rows).toEqual([
      'OPTIONS|[["error","NotImplementedError",null,"worker_threads.error.custom-inspect"],["exit",1]]',
    ]);
  } finally {
    await closeOwner(page);
  }
});
