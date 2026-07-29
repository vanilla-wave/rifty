/**
 * CLI report template — run-to-completion worker path.
 *
 * Covers the non-server side of the real-project lifecycle: selecting the
 * template runs a Node entry once, streams stdout to the terminal, exits with
 * code 0, and leaves no preview iframe behind.
 */
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import {
  capturePageProblems,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLineSettled,
  selectPreset,
  terminalBuffer,
} from './helpers/playground.ts';

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

function hostNodeStdout(args: readonly string[]): string {
  return execFileSync(process.execPath, [...args], { encoding: 'utf8' })
    .replace(ANSI_SGR, '')
    .replaceAll('\r\n', '\n')
    .trimEnd();
}

function settledCommandOutput(buffer: string, line: string): string {
  const normalized = buffer.replaceAll('\r\n', '\n');
  const marker = `> ${line}`;
  const start = normalized.lastIndexOf(marker);
  if (start < 0) throw new Error(`terminal command marker missing: ${line}`);
  const afterCommand = normalized.slice(start + marker.length).replace(/^\n/u, '');
  const end = afterCommand.lastIndexOf('\n> ');
  if (end < 0) throw new Error(`terminal completion prompt missing: ${line}`);
  return afterCommand.slice(0, end).trimEnd();
}

test.describe('CLI report template through the worker lifecycle', () => {
  test('preset exits cleanly and physical node -e/-p match the host Node oracle', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const problems = capturePageProblems(page);
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    await selectPreset(page, 'cli-report');

    await expectTerminalContains(page, 'cli: running CLI report', 120_000);
    await expectTerminalContains(page, 'npm: + yaml@', 120_000);
    await expectTerminalContains(page, '[cli] package report', 30_000);
    await expectTerminalContains(page, '[cli] packages=3 -> api, docs, jobs', 30_000);
    await expectTerminalContains(page, '[cli] completed with exit code 0', 30_000);

    await expect(page.locator('iframe[title^="Preview port"]')).toHaveCount(0);

    await openShellTerminal(page);
    const evalSource = 'console.log(process.argv.length,__filename)';
    const evalArgs = ['-e', evalSource, 'alpha'] as const;
    const evalLine = `node -e '${evalSource}' alpha`;
    const evalOracle = hostNodeStdout(evalArgs);
    expect(evalOracle).toBe('2 [eval]');
    await runTerminalLineSettled(page, evalLine, 60_000);
    expect(settledCommandOutput(await terminalBuffer(page), evalLine)).toBe(evalOracle);

    const printSource = 'process.argv.slice(1).join("|")';
    const printArgs = ['-p', printSource, 'alpha', 'two words'] as const;
    const printLine = `node -p '${printSource}' alpha 'two words'`;
    const printOracle = hostNodeStdout(printArgs);
    expect(printOracle).toBe('alpha|two words');
    await runTerminalLineSettled(page, printLine, 60_000);
    expect(settledCommandOutput(await terminalBuffer(page), printLine)).toBe(printOracle);

    problems.assertNoViteImportErrors();
  });
});
