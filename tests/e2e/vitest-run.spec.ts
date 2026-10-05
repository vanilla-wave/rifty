import { type Page, expect, test } from '@playwright/test';
import {
  bootShell,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

/**
 * vitest-run-in-browser acceptance (goal I1–I7): the exact pair vitest
 * 4.1.11 / vite 8.0.16 installs with npm's own overrides spelling and
 * `vitest run` reports real pass/fail with Node's exit codes on BOTH pools.
 * Assertions cover reporter lines/counts and exit codes — not timing/ANSI.
 */
async function runToolingLine(page: Page, line: string, timeout: number): Promise<string> {
  await runTerminalLineSettled(page, line, timeout);
  const buffer = await terminalBuffer(page);
  const commandStart = buffer.lastIndexOf(`> ${line}`);
  if (commandStart < 0) throw new Error(`Terminal command echo missing for ${line}`);
  return buffer.slice(commandStart + line.length + 2);
}

test.describe('vitest runs in the browser shell (vitest 4.1.11 + vite 8.0.16)', () => {
  test('npm install -> vitest run: real pass/fail, exit codes, both pools', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(600_000);
    await bootShell(page);
    await openShellTerminal(page);

    const setupLine = [
      'mkdir -p src',
      'rm -f package-lock.json',
      `echo '{"name":"vitest-demo","version":"0.0.0","private":true,"type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"4.1.11"},"overrides":{"vite":"8.0.16"}}' > package.json`,
      `echo 'import { defineConfig } from "vitest/config"; export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });' > vitest.config.ts`,
      `echo 'export const sum = (a: number, b: number): number => a + b;' > src/sum.ts`,
      `echo 'import { expect, test } from "vitest"; import { sum } from "./sum"; test("passes", () => { expect(sum(1, 2)).toBe(3); }); test("fails", () => { expect(sum(1, 2)).toBe(4); });' > src/sum.test.ts`,
      `echo 'const ignored = "not collected";' > src/ignored.spec.ts`,
    ].join(' && ');
    await runTerminalLineSettled(page, setupLine, 30_000);
    expect(await terminalHistoryExitCode(page, setupLine)).toBe(0);

    // I1: npm's bare-version overrides spelling installs one vite 8.0.16.
    const installOutput = await runToolingLine(page, 'npm install', 300_000);
    expect(installOutput).toMatch(/npm: installed \d+ package\(s\)/);
    expect(installOutput).toContain('npm: + vitest@4.1.11');
    expect(installOutput).toContain('npm: + vite@8.0.16');
    expect(await terminalHistoryExitCode(page, 'npm install')).toBe(0);

    // I4: the default (forks) pool reports 1 passed 1 failed and exits 1;
    // the config's include glob is honoured (ignored.spec.ts not collected).
    const failingRun = await runToolingLine(page, 'vitest run', 240_000);
    expect(failingRun).toMatch(/src\/sum\.test\.ts/);
    expect(failingRun).not.toMatch(/src\/ignored\.spec\.ts/);
    expect(failingRun).toMatch(/1 passed/);
    expect(failingRun).toMatch(/1 failed/);
    expect(failingRun).toMatch(/expect\(sum\(1, 2\)\)\.toBe\(4\)|Expected:.*4/s);
    expect(await terminalHistoryExitCode(page, 'vitest run')).toBe(1);

    // Fix the test -> exit 0.
    const fixLine =
      'echo \'import { expect, test } from "vitest"; import { sum } from "./sum"; test("passes", () => { expect(sum(1, 2)).toBe(3); }); test("fails", () => { expect(sum(1, 2)).toBe(3); });\' > src/sum.test.ts';
    await runTerminalLineSettled(page, fixLine, 30_000);
    expect(await terminalHistoryExitCode(page, fixLine)).toBe(0);
    const passingRun = await runToolingLine(page, 'vitest run', 240_000);
    expect(passingRun).toMatch(/2 passed/);
    expect(passingRun).not.toMatch(/\d+ failed/);
    expect(await terminalHistoryExitCode(page, 'vitest run')).toBe(0);

    // npm test behaves the same.
    const npmTestOutput = await runToolingLine(page, 'npm test', 240_000);
    expect(npmTestOutput).toMatch(/2 passed/);
    expect(await terminalHistoryExitCode(page, 'npm test')).toBe(0);

    // --reporter=verbose behaves the same.
    const verboseLine = 'vitest run --reporter=verbose';
    const verboseOutput = await runToolingLine(page, verboseLine, 240_000);
    expect(verboseOutput).toMatch(/2 passed/);
    expect(verboseOutput).toMatch(/passes|fails/);
    expect(await terminalHistoryExitCode(page, verboseLine)).toBe(0);

    // I5: the threads pool reports the same results and exit code.
    const threadsLine = 'vitest run --pool=threads';
    const threadsOutput = await runToolingLine(page, threadsLine, 240_000);
    expect(threadsOutput).toMatch(/2 passed/);
    expect(threadsOutput).not.toMatch(/\d+ failed/);
    expect(await terminalHistoryExitCode(page, threadsLine)).toBe(0);

    // I7 adjacent: unclaimed options stay loud (named NotImplementedError),
    // never silent fallback.
    const jsdomLine = 'vitest run --environment=jsdom';
    const jsdomOutput = await runToolingLine(page, jsdomLine, 120_000);
    expect(jsdomOutput).toMatch(/NotImplementedError|not implemented/i);
    expect(await terminalHistoryExitCode(page, jsdomLine)).not.toBe(0);
  });
});
