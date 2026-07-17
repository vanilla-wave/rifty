import { expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

/**
 * The frictionless-first-poke epic Done-gate: a "curious first 15 minutes" walk.
 * A developer pokes the terminal with reflexive moves — they must WORK or fail
 * loud+directed, never with a bare MODULE_NOT_FOUND / command not found /
 * unknown subcommand that reads as fundamentally broken.
 */
test.describe('M0 - curious first 15 minutes', () => {
  // Serial: both tests cold-boot the same dev server; parallel contention over
  // the shared owner garbles the terminal buffer reads.
  test.describe.configure({ mode: 'serial' });

  test('the terminal greets and the reflexive first moves work', async ({ page }) => {
    test.setTimeout(120_000);
    await bootProjectFiles(page);
    await openShellTerminal(page);
    await expect
      .poll(() => terminalBuffer(page), { timeout: 15_000 })
      .toContain('rifty · node v24.0.0');

    // The very first thing the visitor sees: a version line + try-this hints,
    // before they type anything.
    const greeting = await terminalBuffer(page);
    expect(greeting).toContain('rifty · node v24.0.0 · npm in your browser');
    expect(greeting).toContain('try:');
    expect(greeting).toContain('node -v');

    // Project-first admission owns the shell namespace; use a fresh project shell
    // so the preset's dev process cannot share the active terminal.

    // `node -v` — the universal sanity check (must be parsed as a flag, not a file).
    await runTerminalLineSettled(page, 'node -v');
    await expectTerminalContains(page, /v24\.0\.0/);

    // The supported file-entry path runs real CommonJS in the Node child realm.
    await runTerminalLineSettled(
      page,
      'echo \'console.log("filemarker", 41 + 1)\' > first-poke.cjs',
    );
    await runTerminalLineSettled(page, 'node first-poke.cjs', 60_000);
    await expectTerminalContains(page, 'filemarker 42', 60_000);

    // `help` lists the commands (was command-not-found exit 127).
    await runTerminalLineSettled(page, 'help');
    await expectTerminalContains(page, 'run programs');

    // Pipes: the most reflexive terminal action (`cat x | grep y`).
    await runTerminalLineSettled(page, 'echo pipealpha > pipe.txt');
    await runTerminalLineSettled(page, 'echo pipebeta >> pipe.txt');
    await runTerminalLineSettled(page, 'cat pipe.txt | grep beta');
    await expectTerminalContains(page, 'pipebeta');

    // No step surfaced a bare unfixable-looking error.
    const buf = await terminalBuffer(page);
    expect(buf).not.toContain('MODULE_NOT_FOUND');
    expect(buf).not.toContain('Cannot find module');
    expect(buf).not.toContain('unknown subcommand');
  });

  test('every ceiling fails loud + explicit, not silently or wrong', async ({ page }) => {
    test.setTimeout(120_000);
    await bootProjectFiles(page);
    await openShellTerminal(page);

    // Eval identity is not implemented: do not revive the legacy temporary-file lie.
    await runTerminalLineSettled(page, 'node -e "1"');
    await expectTerminalContains(page, 'Not implemented: workbench.node.eval-context');

    // Unknown node flag → `bad option`, never a MODULE_NOT_FOUND for a file path.
    await runTerminalLineSettled(page, 'node --frobnicate');
    await expectTerminalContains(page, 'node: bad option: --frobnicate');

    // `npm test` with no script → npm's missing-script message, not `unknown subcommand`.
    await runTerminalLineSettled(page, 'npm test');
    await expectTerminalContains(page, /missing script/i);

    // `npm i -g` → a directed sandbox message, not the generic M9-scope line.
    await runTerminalLineSettled(page, 'npm install -g typescript');
    await expectTerminalContains(page, "global installs aren't supported in the browser sandbox");

    // A fat-fingered package manager → an npm nudge, not a wrong one-click `Run npm`.
    await runTerminalLineSettled(page, 'pnpm install left-pad');
    await expectTerminalContains(page, 'pnpm: not available');

    // Command substitution `$(…)` is a loud ceiling (no silent literal pass-through),
    // proven by the shell unit suite — `echo $(date)` runs nothing and prints no
    // `date` value. (Its tokenizer throw is covered in packages/shell/shell.test.ts.)
    const buf = await terminalBuffer(page);
    expect(buf).not.toContain('MODULE_NOT_FOUND');
    expect(buf).not.toContain('unknown subcommand');
    // Not one of the casual ceilings showed a bare command-not-found 127.
    expect(buf).not.toMatch(/bad option[\s\S]*command not found/);
  });
});
