import { test } from '@playwright/test';
import {
  bootShell,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
} from './helpers/playground.ts';

/**
 * M4 acceptance: shell file commands over the browser-backed VFS. The default
 * terminal owns the visible Vite process, so each test opens a separate idle
 * terminal and drives commands through the same shell a user sees.
 */
test.describe('M4 — FileSystem', () => {
  test('write + read round-trip', async ({ page }) => {
    await bootShell(page);
    await openShellTerminal(page);
    await runTerminalLine(page, 'mkdir -p /tmp && echo hi-rifty > /tmp/n.txt && cat /tmp/n.txt');
    await expectTerminalContains(page, 'hi-rifty');
  });

  test('mkdir recursive + ls', async ({ page }) => {
    await bootShell(page);
    await openShellTerminal(page);
    await runTerminalLine(
      page,
      'mkdir -p /home/project/a/b/c && echo L > /home/project/a/b/c/leaf.txt && ls /home/project/a/b/c',
    );
    await expectTerminalContains(page, 'leaf.txt');
  });

  test('wc reports file size', async ({ page }) => {
    await bootShell(page);
    await openShellTerminal(page);
    await runTerminalLine(
      page,
      'mkdir -p /home/project/t && printf abc > /home/project/t/x.txt && wc -c /home/project/t/x.txt',
    );
    await expectTerminalContains(page, /3\s+\/home\/project\/t\/x\.txt/);
  });
});
