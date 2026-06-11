import { type Page, expect } from '@playwright/test';

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

function stripTerminal(text: string): string {
  return text.replace(ANSI_SGR, '');
}

export async function terminalBuffer(
  page: Page,
  slot: 'active' | number = 'active',
): Promise<string> {
  const locator =
    slot === 'active'
      ? page.locator('.rf-terminal-slot[data-active="true"] [data-testid="terminal-buffer"]')
      : page.locator('.rf-terminal-slot').nth(slot).locator('[data-testid="terminal-buffer"]');
  return stripTerminal((await locator.getAttribute('data-terminal-buffer')) ?? '');
}

export async function openShellTerminal(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'New terminal' })).toBeVisible();
  await page.getByRole('button', { name: 'New terminal' }).click();
  await expect(page.getByRole('tab', { name: /Terminal 2/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

export async function runTerminalLine(page: Page, line: string): Promise<void> {
  await page.locator('[data-testid="terminal"]').click();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

export async function expectTerminalContains(
  page: Page,
  text: string | RegExp,
  timeout = 5_000,
): Promise<void> {
  await expect.poll(() => terminalBuffer(page), { timeout }).toMatch(text);
}
