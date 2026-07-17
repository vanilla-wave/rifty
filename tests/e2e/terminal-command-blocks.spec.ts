import { type Page, expect, test } from '@playwright/test';
import {
  bootShell,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

function terminalTab(page: Page, sessionId: string) {
  return page.locator(`.rf-terminal-tab__select[data-session-id="${sessionId}"]`);
}

test.describe('Terminal command blocks UX', () => {
  test('bottom panel exposes shell context in the terminal hint', async ({ page }) => {
    await bootShell(page);
    const shell = await openShellTerminal(page);
    await expect(terminalTab(page, shell.sessionId)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="problems-tab"]')).toBeVisible();
    const modeHint = page.locator(
      `.rf-terminal-slot[data-session-id="${shell.sessionId}"] [data-testid="terminal-mode-hint"]`,
    );
    await expect(modeHint).toContainText('Shell');
    await expect(modeHint).toContainText('Commands run in /;');
  });

  test('terminal commands run without legacy command overlays', async ({ page }) => {
    test.setTimeout(120_000);
    await bootShell(page);
    const shell = await openShellTerminal(page);

    await runTerminalLineSettled(page, 'echo block-preview-output');
    await expectTerminalContains(page, 'block-preview-output');
    await runTerminalLineSettled(page, 'pwd');
    const output = await terminalBuffer(page, shell);
    const pwdBlock = output.slice(output.lastIndexOf('> pwd'));
    expect(pwdBlock).toMatch(/> pwd\r?\n\/\r?\n>\s*$/u);
    await expect(
      page.locator(
        `.rf-terminal-slot[data-session-id="${shell.sessionId}"] [data-testid="terminal-mode-hint"]`,
      ),
    ).toContainText('Commands run in /;');

    await runTerminalLineSettled(
      page,
      'echo \'import fs from "node:fs"; console.log("CWD=" + process.cwd()); console.log("PKG_READ=" + (JSON.parse(fs.readFileSync("/package.json", "utf8")).private === true));\' > namespace-proof.mjs',
    );
    await runTerminalLineSettled(page, 'node namespace-proof.mjs', 60_000);
    const nodeOutput = await terminalBuffer(page, shell);
    const nodeBlock = nodeOutput.slice(nodeOutput.lastIndexOf('> node namespace-proof.mjs'));
    expect(nodeBlock).toMatch(/CWD=\/\r?\nPKG_READ=true/u);
    expect(nodeBlock).not.toContain('/.rifty/workbench');

    await expect(page.locator('.rf-terminal-blockrail__item')).toHaveCount(0);
    await expect(page.locator('#terminal-block-preview')).toHaveCount(0);
    await expect(page.locator('.rf-terminal-sticky')).toHaveCount(0);
  });
});
