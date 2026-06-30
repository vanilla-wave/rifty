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

export async function openShellTerminal(
  page: Page,
  options: { readonly focus?: boolean } = {},
): Promise<number> {
  const focus = options.focus ?? true;
  await expect(page.getByRole('button', { name: 'New terminal' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Terminal \d+/ }).first()).toBeVisible();
  await expect(page.locator('.rf-terminal-slot').first()).toBeAttached();
  const terminalTabs = page.getByRole('tab', { name: /Terminal \d+/ });
  const terminalSlots = page.locator('.rf-terminal-slot');
  const tabCountBefore = await terminalTabs.count();
  const slotCountBefore = await terminalSlots.count();
  await page.getByRole('button', { name: 'New terminal' }).click();
  await expect
    .poll(() => terminalTabs.count(), { timeout: 10_000 })
    .toBeGreaterThan(tabCountBefore);
  await expect
    .poll(() => terminalSlots.count(), { timeout: 10_000 })
    .toBeGreaterThan(slotCountBefore);
  const tab = terminalTabs.last();
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.rf-terminal-slot[data-active="true"]')).toHaveCount(1);
  const slotIndex = await terminalSlots.evaluateAll((slots) =>
    slots.findIndex((slot) => slot.getAttribute('data-active') === 'true'),
  );
  if (slotIndex < 0) throw new Error('new terminal did not activate a terminal slot');
  const slot = terminalSlots.nth(slotIndex);
  await expect
    .poll(() => terminalBuffer(page, slotIndex), { timeout: 30_000 })
    .toMatch(/^\s*>\s*$/u);
  if (!focus) return slotIndex;
  await slot.locator('[data-testid="terminal"]').click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const terminal = document.querySelector('[data-testid="terminal"]');
          const active = document.activeElement;
          return terminal != null && active != null && terminal.contains(active);
        }),
      { timeout: 5_000 },
    )
    .toBe(true);
  return slotIndex;
}

export async function runTerminalLine(
  page: Page,
  line: string,
  targetSlot: 'active' | number = 'active',
): Promise<void> {
  if (targetSlot !== 'active') {
    const tab = page.getByRole('tab', { name: /Terminal \d+/ }).nth(targetSlot);
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  const slot =
    targetSlot === 'active'
      ? page.locator('.rf-terminal-slot[data-active="true"]')
      : page.locator('.rf-terminal-slot').nth(targetSlot);
  await expect(slot).toBeVisible();
  await expect.poll(() => terminalBuffer(page, targetSlot), { timeout: 30_000 }).toMatch(/>\s*$/u);
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
  targetSlot: 'active' | number = 'active',
): Promise<void> {
  const before = terminalPromptCount(await terminalBuffer(page, targetSlot));
  if (targetSlot !== 'active') {
    const tab = page.getByRole('tab', { name: /Terminal \d+/ }).nth(targetSlot);
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  const slot =
    targetSlot === 'active'
      ? page.locator('.rf-terminal-slot[data-active="true"]')
      : page.locator('.rf-terminal-slot').nth(targetSlot);
  await expect(slot).toBeVisible();
  await expect.poll(() => terminalBuffer(page, targetSlot), { timeout: 30_000 }).toMatch(/>\s*$/u);
  await slot.locator('[data-testid="terminal"]').click();
  await page.keyboard.insertText(line);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => terminalPromptCount(await terminalBuffer(page, targetSlot)), { timeout })
    .toBeGreaterThan(before);
}

export async function expectTerminalContains(
  page: Page,
  text: string | RegExp,
  timeout = 5_000,
): Promise<void> {
  await expect.poll(() => terminalBuffer(page), { timeout }).toMatch(text);
}
