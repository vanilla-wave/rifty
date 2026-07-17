import { type Locator, type Page, expect, test } from '@playwright/test';
import {
  type TerminalSessionTarget,
  bootShell,
  insertTerminalLineSettled,
  openShellTerminal,
  terminalBuffer,
} from './helpers/playground.ts';

function terminalSlot(page: Page, shell: TerminalSessionTarget): Locator {
  return page.locator(`.rf-terminal-slot[data-session-id="${shell.sessionId}"]`);
}

async function openHistory(page: Page, shell: TerminalSessionTarget): Promise<Locator> {
  const slot = terminalSlot(page, shell);
  const history = slot.locator('.rf-terminal-history');
  const terminal = slot.locator('.rf-terminal');
  const textarea = slot.locator('textarea.xterm-helper-textarea, textarea').first();

  await expect
    .poll(
      async () => {
        if (await history.isVisible({ timeout: 0 }).catch(() => false)) return true;
        await terminal.click();
        await textarea.focus();
        await textarea.dispatchEvent('keydown', {
          key: 'r',
          code: 'KeyR',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        return history.isVisible({ timeout: 0 }).catch(() => false);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(history.locator('.rf-terminal-history__input')).toBeFocused();
  return history;
}

async function closeHistory(history: Locator): Promise<void> {
  await history.locator('.rf-terminal-history__input').press('Escape');
  await expect(history).toHaveCount(0);
}

test.describe('Terminal persistence', () => {
  test('shell-mode command history records submitted input', async ({ page }) => {
    await bootShell(page);
    const shell = await openShellTerminal(page);

    await insertTerminalLineSettled(page, 'll ', 30_000, shell);

    const history = await openHistory(page, shell);
    const first = history.locator('.rf-terminal-history__item').first();
    await expect(first).toBeVisible();
    expect(await first.locator('.rf-terminal-history__cmd').textContent()).toBe('ll ');
    await expect(first.locator('.rf-terminal-history__meta')).toContainText('/ · real-vite ·');
  });

  test('persists rich command history after reload', async ({ page }) => {
    await bootShell(page);
    const shell = await openShellTerminal(page);

    const marker = `smoke${Date.now().toString(36)}`;
    const expectedCommands = ['pwd', `echo ${marker}`] as const;

    await insertTerminalLineSettled(page, `echo ${marker}`, 30_000, shell);
    const echoHistory = await openHistory(page, shell);
    await expect(echoHistory.locator('.rf-terminal-history__cmd').first()).toHaveText(
      `echo ${marker}`,
    );
    await closeHistory(echoHistory);

    await insertTerminalLineSettled(page, 'pwd', 30_000, shell);
    const beforeReload = await openHistory(page, shell);
    const beforeCommands = beforeReload.locator('.rf-terminal-history__cmd');
    await expect(beforeCommands.nth(0)).toHaveText(expectedCommands[0]);
    await expect(beforeCommands.nth(1)).toHaveText(expectedCommands[1]);
    await closeHistory(beforeReload);

    await page.reload();

    await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(
      'Project files scratch',
      { timeout: 90_000 },
    );
    const reopenedShell = await openShellTerminal(page);
    const history = await openHistory(page, reopenedShell);
    const commands = history.locator('.rf-terminal-history__cmd');
    await expect(commands.nth(0)).toHaveText(expectedCommands[0]);
    await expect(commands.nth(1)).toHaveText(expectedCommands[1]);
    await expect(
      history.locator('.rf-terminal-history__item').first().locator('.rf-terminal-history__meta'),
    ).toContainText('/ · real-vite ·');

    const items = history.locator('.rf-terminal-history__item');
    const input = history.locator('.rf-terminal-history__input');
    // Mouse position may hover either result as the overlay opens. Keyboard
    // navigation first clamps selection to the newest record deterministically.
    await input.press('ArrowUp');
    await expect(items.nth(0)).toHaveAttribute('data-active', 'true');
    await input.press('ArrowDown');
    await expect(items.nth(1)).toHaveAttribute('data-active', 'true');
    await input.press('Enter');
    await expect(history).toHaveCount(0);

    // Enter chose the second persisted command into the prompt. Submit that
    // already-populated line and require a second marker occurrence (its output)
    // plus the next prompt: restored history is observable as behavior, not JSON.
    const reopenedSlot = terminalSlot(page, reopenedShell);
    await reopenedSlot.locator('.rf-terminal').click();
    const terminalInput = reopenedSlot.locator('textarea.xterm-helper-textarea, textarea').first();
    await terminalInput.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(
        async () => {
          const buffer = await terminalBuffer(page, reopenedShell);
          return {
            markerCount: buffer.split(marker).length - 1,
            atPrompt: />\s*$/u.test(buffer),
          };
        },
        { timeout: 30_000 },
      )
      .toEqual({ markerCount: 2, atPrompt: true });
  });
});
