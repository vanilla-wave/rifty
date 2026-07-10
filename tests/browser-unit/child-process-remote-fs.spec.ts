import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

test('real Worker spawn/fork share parent VFS, stdio, cwd/env, exit and IPC', async ({ page }) => {
  await gotoHarness(page);

  const result = await page.evaluate(async () => {
    const probe = await import('/src/browser-unit/child-process-remote-fs-harness.ts');
    return await probe.runRemoteFsChildProcessProbe();
  });

  expect(result.spawnCode).toBe(0);
  expect(result.spawnTarget).toBe('DATA=parent-vfs-bytes;ENV=worker-env;CWD=/project\n');
  expect(result.spawnStderr).toBe('');
  expect(result.spawnStdioShape).toBe('pipe,null,null');
  expect(result.forkCode).toBe(0);
  expect(result.forkReply).toEqual({ echo: { from: 'parent' }, data: 'ipc-ok' });
  expect(result.forkStdioShape).toBe('null,null,null');
});
