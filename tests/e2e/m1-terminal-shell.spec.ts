import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

test.describe('M1 - terminal shell', () => {
  test('bottom panel is a shell terminal and prestarts Vite visibly', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Collapse terminal' })).toContainText('Terminal');
    await expect(page.locator('[data-testid="terminal-mode-hint"]')).toContainText(
      'Commands run in /workspace',
    );
    await expect.poll(() => terminalBuffer(page), { timeout: 10_000 }).toContain('$ vite');
    await expect(page.locator('.rf-terminal-tab')).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Terminal 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('new terminal opens a separate idle shell while Vite keeps running', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => terminalBuffer(page), { timeout: 10_000 }).toContain('$ vite');

    await openShellTerminal(page);

    await expect(page.locator('.rf-terminal-tab')).toHaveCount(2);
    await expect(page.locator('.rf-terminal-tab').first()).toHaveAttribute('data-running', 'true');

    await runTerminalLine(page, 'echo hello-from-shell');

    await expectTerminalContains(page, 'hello-from-shell');
    expect(await terminalBuffer(page)).not.toContain('[worker ready]');
  });
});
