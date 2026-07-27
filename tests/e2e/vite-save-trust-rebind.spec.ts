import { type Page, expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectViteDevServerReady,
  openShellTerminal,
  pickStarter,
  readActiveProjectText,
  runTerminalLineSettled,
} from './helpers/playground.ts';

const TRANSITION_TIMEOUT = 120_000;

async function openProjects(page: Page): Promise<void> {
  await page.click('[data-action="open-launcher"]');
  await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /^Projects/ }).click();
}

async function saveScratchAs(page: Page, name: string): Promise<void> {
  await openProjects(page);
  await page.locator('[data-action="save-scratch"]').click();
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await dialog.locator('input.rf-dialog__input').fill(name);
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.rf-dialog[role="dialog"]') === null ||
      document.querySelector('.rf-toast[data-tone="error"]') !== null,
    undefined,
    { timeout: TRANSITION_TIMEOUT },
  );
  const errorToast = page.locator('.rf-toast[data-tone="error"]');
  const error = (await errorToast.count()) === 0 ? null : await errorToast.textContent();
  if (error !== null) throw new Error(`Save transition failed: ${error}`);
  await expect(dialog).toHaveCount(0, { timeout: TRANSITION_TIMEOUT });
  await page.locator('.rf-launcher__close').click();
}

async function switchToProject(page: Page, name: string): Promise<void> {
  await openProjects(page);
  const card = page.locator('.rf-pcard[data-project]', { hasText: name }).first();
  await expect(card).toHaveAttribute('role', 'button', { timeout: TRANSITION_TIMEOUT });
  await card.click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, {
    timeout: TRANSITION_TIMEOUT,
  });
}

/**
 * ADR-0329 desired contract. RED on 84c810c8: Save drops the trusted
 * root-bound claim, attempts snapshot acquisition, and cannot keep A LIVE
 * after acquisition is blocked.
 */
test('trusted Scratch Save and A→B→A reopen stay exact with acquisition offline', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
  test.setTimeout(300_000);

  const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const projectA = `Trusted-A-${tag}`;
  const projectB = `Warm-B-${tag}`;
  const markerText = `exact-before-save-${tag}`;

  await bootProjectFiles(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  });
  await expectViteDevServerReady(page, 5174, 120_000);

  await saveScratchAs(page, projectB);
  await expectViteDevServerReady(page, 5174, 120_000);

  await pickStarter(page, 'project-files');
  await expectViteDevServerReady(page, 5174, 120_000);
  await openShellTerminal(page);
  await runTerminalLineSettled(
    page,
    `mkdir -p /node_modules/.vite-save-red && echo ${markerText} > /node_modules/.vite-save-red/marker.txt`,
    30_000,
  );

  const acquisitionRequests: string[] = [];
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/snapshots/') || url.pathname.startsWith('/npm-registry')) {
      acquisitionRequests.push(url.pathname);
      await route.abort();
      return;
    }
    await route.continue();
  });

  await saveScratchAs(page, projectA);
  await expectViteDevServerReady(page, 5174, 120_000);
  await switchToProject(page, projectB);
  await expectViteDevServerReady(page, 5174, 120_000);
  await switchToProject(page, projectA);
  await expectViteDevServerReady(page, 5174, 120_000);

  const marker = await readActiveProjectText(
    page,
    'node_modules/.vite-save-red/marker.txt',
    30_000,
  );
  expect(marker).toEqual({ exists: true, text: `${markerText}\n` });
  expect(acquisitionRequests).toEqual([]);
});
