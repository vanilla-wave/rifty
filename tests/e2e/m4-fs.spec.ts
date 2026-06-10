import { test } from '@playwright/test';
import {
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
    await page.goto('/');
    await openShellTerminal(page);
    await runTerminalLine(page, 'mkdir -p /tmp && echo hi-rifty > /tmp/n.txt && cat /tmp/n.txt');
    await expectTerminalContains(page, 'hi-rifty');
  });

  test('mkdir recursive + ls', async ({ page }) => {
    await page.goto('/');
    await openShellTerminal(page);
    await runTerminalLine(page, 'mkdir -p /a/b/c && echo L > /a/b/c/leaf.txt && ls /a/b/c');
    await expectTerminalContains(page, 'leaf.txt');
  });

  test('wc reports file size', async ({ page }) => {
    await page.goto('/');
    await openShellTerminal(page);
    await runTerminalLine(page, 'mkdir -p /t && printf abc > /t/x.txt && wc -c /t/x.txt');
    await expectTerminalContains(page, /3\s+\/t\/x\.txt/);
  });
});
