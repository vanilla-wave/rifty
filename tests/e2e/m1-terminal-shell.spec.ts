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

  test('instant preset boots straight to vite — deps pre-seeded, NO install (ADR-0135)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await expect.poll(() => terminalBuffer(page), { timeout: 10_000 }).toContain('$ vite');

    // Fresh browser context = empty OPFS = no stamp: an instant preset's deps are
    // PRE-SEEDED from the baked snapshot (owner-seed), so the dev line just runs.
    // Faithful: `vite` does NOT install — no `npm: +` lines ever — and serves.
    await expectTerminalContains(page, '[vite] dev server ready on port 5174', 60_000);
    const buf = await terminalBuffer(page);
    expect(buf).not.toMatch(/npm: \+ /);
    expect(buf).not.toContain('installing');
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

  test('terminal tabs switch between their own buffers', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => terminalBuffer(page), { timeout: 10_000 }).toContain('$ vite');

    await openShellTerminal(page);
    await runTerminalLine(page, 'echo hello-from-terminal-2');
    await expectTerminalContains(page, 'hello-from-terminal-2');

    await page.getByRole('tab', { name: 'Terminal 1' }).click();
    await expect(page.getByRole('tab', { name: 'Terminal 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect.poll(() => terminalBuffer(page)).toContain('$ vite');
    expect(await terminalBuffer(page)).not.toContain('hello-from-terminal-2');

    await page.getByRole('tab', { name: 'Terminal 2' }).click();
    await expect(page.getByRole('tab', { name: 'Terminal 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expectTerminalContains(page, 'hello-from-terminal-2');
  });

  test('closing an idle terminal returns to the running terminal cleanly', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => terminalBuffer(page), { timeout: 10_000 }).toContain('$ vite');

    await openShellTerminal(page);
    await page.getByRole('button', { name: 'Close Terminal 2' }).click();

    await expect(page.locator('.rf-terminal-tab')).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Terminal 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.rf-terminal-slot[data-active="true"]')).toHaveCount(1);
    await expect.poll(() => terminalBuffer(page)).toContain('$ vite');
  });

  test('new-terminal button stays attached to the terminal tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('tab', { name: 'Terminal 1' })).toBeVisible();

    await openShellTerminal(page);

    const lastTabBox = await page.locator('.rf-terminal-tab').last().boundingBox();
    const actionBox = await page.getByRole('button', { name: 'New terminal' }).boundingBox();

    expect(lastTabBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    const gap = Math.abs((actionBox?.x ?? 0) - ((lastTabBox?.x ?? 0) + (lastTabBox?.width ?? 0)));
    expect(gap).toBeLessThanOrEqual(1);
  });

  test('npm run vite resolves the seeded script + routes to the co-resident dev server', async ({
    page,
  }) => {
    await page.goto('/');
    // ADR-0148: the default preset boots its dev server in the owner — wait up.
    await expectTerminalContains(page, 'starting dev server on port', 15_000);

    await openShellTerminal(page);
    await runTerminalLine(page, 'npm run vite');

    // The owner npm resolves the `vite` package script and routes it to the
    // co-resident dev server; one is already running (boot), so the single-active
    // guard reports it — proving the script resolved (not unknown/missing).
    await expectTerminalContains(page, 'dev server already running', 10_000);
    const buf = await terminalBuffer(page);
    expect(buf).not.toContain("unknown subcommand 'run'");
    expect(buf).not.toContain('missing script');
  });
});
