/** Project surfaces name the active project, never its owner storage path. */
import { expect, test } from '@playwright/test';
import { pickStarter, waitForProjectIndex } from './helpers/playground.ts';

test.describe('project boot root', () => {
  test('root-keyed surfaces never expose an owner root or Starter-derived path', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await waitForProjectIndex(page);
    await expect(page.locator('[data-action="open-launcher"]')).toContainText('Choose project');
    await pickStarter(page, 'project-files');

    const hint = page.locator('[data-testid="terminal-mode-hint"]').first();
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText('running programs own stdin', { timeout: 15_000 });
    await expect(hint).not.toContainText('/projects/project-files');

    // The chip names the active scratch from its Starter label, never a project id
    // — corroborates the single source from the other surface.
    await expect(page.locator('[data-action="open-launcher"]')).toContainText(
      'Project files scratch',
    );
  });
});
