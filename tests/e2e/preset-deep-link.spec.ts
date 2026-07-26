import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

// The `?preset=<id>&autorun=1` deep-link (shareable launch URL + the perf
// harness, docs/backlog/perf/cold-start-and-install-benchmark): a cold tab boots
// straight into the preset and, with autorun=1, runs its boot lines.
//
// `real-vite` is a from-scratch preset → its boot lines run `npm install && npm
// run dev`. The DEFAULT preset (`project-files`, setup:'instant') never installs,
// so `npm install` in the terminal proves BOTH that the deep-link applied
// real-vite AND that autorun fired — i.e. without the deep-link wiring this page
// would boot the default and never print `npm install` (the RED state).
test('?preset=real-vite&autorun=1 cold-boots real-vite and auto-installs', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?preset=real-vite&autorun=1');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 20_000,
  });
  await expectTerminalContains(page, /npm install/u, 90_000);
  await expectViteDevServerReady(page, 5174, 120_000);

  await openShellTerminal(page);
  await runTerminalLineSettled(page, 'git status --porcelain && echo STATUS_DONE', 60_000);
  const statusOutput = await terminalBuffer(page);
  const statusBlock = statusOutput.slice(statusOutput.lastIndexOf('git status --porcelain'));
  expect(statusBlock).toContain('STATUS_DONE');
  expect(statusBlock).not.toContain('package-lock.json');
  expect(statusBlock).not.toMatch(/^\?\?/mu);

  const gitTab = page.getByRole('tab', { name: 'GIT', exact: true });
  await gitTab.click();
  await expect(gitTab).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  const filesTab = page.getByRole('tab', { name: 'Files', exact: true });
  await filesTab.click();
  await expect(filesTab).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  const packageLockRow = page.getByRole('treeitem', { name: /^package-lock\.json/u });
  await expect(packageLockRow).toBeVisible();
  await expect.poll(() => packageLockRow.getAttribute('data-git')).toBeNull();

  await page.getByRole('treeitem', { name: 'package.json', exact: true }).click();
  const packageJsonTab = page
    .locator('[role="tablist"][aria-label="Open editors"] [role="tab"]')
    .filter({ hasText: /^package\.json/u });
  await expect(packageJsonTab).toBeVisible();
  await expect(packageJsonTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.rf-toast[data-tone="error"]')).toHaveCount(0);
});
