import { type Page, expect, test } from '@playwright/test';

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

async function terminalBuffer(page: Page): Promise<string> {
  return (
    (await page.locator('[data-testid="terminal-buffer"]').getAttribute('data-terminal-buffer')) ??
    ''
  ).replace(ANSI_SGR, '');
}

test.describe('M1 — JS Execution', () => {
  test('bottom panel is named REPL in worker mode', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Collapse REPL' })).toContainText('REPL');
    await expect(page.locator('[data-testid="console"] .rf-console__sub')).toContainText(
      'JavaScript worker',
    );
  });

  test('terminal evaluates expressions', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await term.click();
    await page.keyboard.type('1 + 1');
    await page.keyboard.press('Enter');
    await expect.poll(() => terminalBuffer(page), { timeout: 5000 }).toContain('2');
  });

  test('REPL help makes the first prompt discoverable', async ({ page }) => {
    await page.goto('/');
    const hint = page.locator('[data-testid="terminal-mode-hint"]');
    await expect(hint).toContainText('JS REPL');
    await hint.getByRole('button', { name: 'Show REPL help' }).click();

    await expect.poll(() => terminalBuffer(page), { timeout: 5000 }).toContain('REPL quick start');
    await expect.poll(() => terminalBuffer(page), { timeout: 5000 }).toContain('1 + 1');
    await expect
      .poll(() => terminalBuffer(page), { timeout: 5000 })
      .toContain('Run executes the editor file main.js.');
    await expect(page.locator('.rf-terminal-blockrail__item[aria-label*=".help"]')).toHaveAttribute(
      'data-status',
      'ok',
    );
  });

  test('REPL hint actions execute examples', async ({ page }) => {
    await page.goto('/');
    const hint = page.locator('[data-testid="terminal-mode-hint"]');
    await hint.getByRole('button', { name: 'Run REPL expression 1 + 1' }).click();
    await expect.poll(() => terminalBuffer(page), { timeout: 5000 }).toContain('2');
  });

  test('Run button executes editor source and streams stdout', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await page.locator('[data-action="run"]').click();
    await expect.poll(() => terminalBuffer(page), { timeout: 10_000 }).toContain('worker alive');
  });

  test('errors render with traceback in red (stderr stream)', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await term.click();
    await page.keyboard.type("throw new Error('boom')");
    await page.keyboard.press('Enter');
    await expect.poll(() => terminalBuffer(page), { timeout: 5000 }).toContain('boom');
  });

  test('console.log goes to stdout, console.error goes to stderr', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await term.click();
    await page.keyboard.type("console.log('OUT-' + 'A'); console.error('ERR-' + 'B')");
    await page.keyboard.press('Enter');
    await expect.poll(() => terminalBuffer(page), { timeout: 5000 }).toContain('OUT-A');
    await expect.poll(() => terminalBuffer(page), { timeout: 5000 }).toContain('ERR-B');
  });

  test('.reset respawns the worker', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await expect.poll(() => terminalBuffer(page), { timeout: 10_000 }).toContain('[worker ready]');
    await term.click();
    await page.keyboard.type('globalThis.__mark = 17');
    await page.keyboard.press('Enter');
    await expect.poll(() => terminalBuffer(page), { timeout: 5000 }).toContain('17');
    await page.keyboard.type('.reset');
    await page.keyboard.press('Enter');
    // worker terminates then respawns -- the new ready event appears as a
    // second [worker ready] in the same terminal.
    await expect
      .poll(() => terminalBuffer(page), { timeout: 5000 })
      .toContain('[worker exited: reset]');
    await page.keyboard.type('typeof globalThis.__mark');
    await page.keyboard.press('Enter');
    await expect.poll(() => terminalBuffer(page), { timeout: 5000 }).toContain('undefined');
  });

  test('REPL mode is labelled and forwards busy input to process.stdin', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await expect(page.locator('[data-testid="terminal-mode-hint"]')).toContainText('JS REPL');
    await term.click();
    await page.keyboard.type(
      "new Promise((resolve) => { let b = ''; process.stdin.on('data', (chunk) => { b += String(chunk); if (b.includes('\\r')) resolve('stdin:' + b.trim()); }); })",
    );
    await page.keyboard.press('Enter');
    await page.keyboard.type('hello from stdin');
    await expect(page.locator('[data-testid="terminal-busy-notice"]')).toBeVisible();
    await page.keyboard.press('Enter');

    await expect
      .poll(() => terminalBuffer(page), { timeout: 5000 })
      .toContain('stdin:hello from stdin');
  });
});
