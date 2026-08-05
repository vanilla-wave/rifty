import { expect, test } from '@playwright/test';
import {
  expectViteDevServerReady,
  resetSandboxThroughUi,
  terminalBuffer,
} from './helpers/playground.ts';

test('every instant preset identifies cold preparation and reaches its real Vite', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');

  await resetSandboxThroughUi(page);
  const launcher = page.locator('[data-testid="launcher"]');
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await launcher.getByRole('button', { name: 'Starters', exact: true }).click();
  const instantPresets = await launcher
    .locator('[data-preset][data-setup="instant"]')
    .evaluateAll((cards) =>
      cards.map((card) => {
        const id = card.getAttribute('data-preset');
        const label = card.querySelector('.rf-starters__label')?.textContent?.trim();
        if (!id || !label) throw new TypeError('Instant preset card has no id or label');
        return { id, label };
      }),
    );
  expect(instantPresets.length).toBeGreaterThan(0);
  testInfo.setTimeout(240_000 * instantPresets.length);

  for (const [index, preset] of instantPresets.entries()) {
    await test.step(preset.label, async () => {
      if (index > 0) {
        await resetSandboxThroughUi(page);
        await expect(launcher).toBeVisible({ timeout: 30_000 });
        await launcher.getByRole('button', { name: 'Starters', exact: true }).click();
      }
      await launcher.locator(`[data-preset="${preset.id}"]`).click();

      await expect(
        page.getByRole('status', {
          name: `Preparing instant project ${preset.label}`,
        }),
      ).toBeVisible({ timeout: 5_000 });
      await expectViteDevServerReady(page, 5174, 180_000);
      await expect(launcher).toHaveCount(0, { timeout: 30_000 });
      await expect(
        page.getByRole('status', {
          name: `Preparing instant project ${preset.label}`,
        }),
      ).toHaveCount(0);
      await expect(page.locator('.rf-toast[data-tone="error"]')).toHaveCount(0);

      const viteVersion = preset.id === 'vite8' ? '8.0.16' : '7.3.6';
      const terminal = await terminalBuffer(page);
      expect(terminal).toMatch(new RegExp(`VITE v${viteVersion}\\s+ready`, 'u'));
      expect(terminal).not.toContain('npm: +');
    });
  }
});
