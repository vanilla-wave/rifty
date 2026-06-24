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
  const slot = page.locator('.rf-terminal-slot[data-active="true"]');
  await expect(slot).toBeVisible();
  await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toMatch(/>\s*$/u);
  await slot.locator('[data-testid="terminal"]').click();
  const input = slot.locator('textarea.xterm-helper-textarea, textarea').first();
  await expect(input).toBeAttached();
  await input.focus();
  await expect
    .poll(() => input.evaluate((el) => document.activeElement === el), { timeout: 5_000 })
    .toBe(true);
  await input.pressSequentially(line);
  await input.press('Enter');
}

function terminalPromptCount(text: string): number {
  return text.match(/(?:^|\n)> /gu)?.length ?? 0;
}

export async function runTerminalLineSettled(
  page: Page,
  line: string,
  timeout = 30_000,
): Promise<void> {
  const before = terminalPromptCount(await terminalBuffer(page));
  await runTerminalLine(page, line);
  await expect
    .poll(async () => terminalPromptCount(await terminalBuffer(page)), { timeout })
    .toBeGreaterThan(before);
}

export async function insertTerminalLineSettled(
  page: Page,
  line: string,
  timeout = 30_000,
): Promise<void> {
  const before = terminalPromptCount(await terminalBuffer(page));
  await page.locator('[data-testid="terminal"]').click();
  await page.keyboard.insertText(line);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => terminalPromptCount(await terminalBuffer(page)), { timeout })
    .toBeGreaterThan(before);
}

export async function expectTerminalContains(
  page: Page,
  text: string | RegExp,
  timeout = 5_000,
): Promise<void> {
  await expect.poll(() => terminalBuffer(page), { timeout }).toMatch(text);
}
