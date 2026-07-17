import { test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
} from './helpers/playground.ts';

test.describe('M2 — Project modules', () => {
  test('the shell can inspect the seeded package.json module project', async ({ page }) => {
    await bootProjectFiles(page);
    await openShellTerminal(page);
    await runTerminalLine(page, 'cat package.json');
    await expectTerminalContains(page, /"dev"\s*:\s*"vite"/u);
  });

  test('the shell can inspect source modules seeded for Vite', async ({ page }) => {
    await bootProjectFiles(page);
    await openShellTerminal(page);
    await runTerminalLine(page, 'ls src');
    await expectTerminalContains(page, /main\.js/);
  });

  test('the shell can read an imported helper module from project files', async ({ page }) => {
    await bootProjectFiles(page);
    await openShellTerminal(page);
    await runTerminalLine(page, 'cat src/project-summary.js');
    await expectTerminalContains(page, 'describeProject');
  });
});
