/** The companion exposes one public project-rooted cwd; owner storage stays private. */
import { expect, test } from '@playwright/test';
import { pickStarter } from './helpers/playground.ts';

test.describe('project boot root', () => {
  test('root-keyed surfaces expose /, never an owner root or Starter-derived path', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await expect(page.locator('[data-action="open-launcher"]')).toContainText('Choose project');
    await pickStarter(page, 'project-files');

    // The hint renders the companion's public project-rooted terminal snapshot.
    const hint = page.locator('[data-testid="terminal-mode-hint"]').first();
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText('Commands run in /;', { timeout: 15_000 });
    await expect(hint).not.toContainText('/projects/project-files');

    // The chip names the active scratch from its Starter label, never a project id
    // — corroborates the single source from the other surface.
    await expect(page.locator('[data-action="open-launcher"]')).toContainText(
      'Project files scratch',
    );
  });
});
