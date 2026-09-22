import { type Page, expect, test } from '@playwright/test';
import {
  bootShell,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

async function runLine(page: Page, line: string, timeout: number): Promise<string> {
  await runTerminalLineSettled(page, line, timeout);
  const buffer = await terminalBuffer(page);
  const commandStart = buffer.lastIndexOf(`> ${line}`);
  if (commandStart < 0) throw new Error(`Terminal command echo missing for ${line}`);
  return buffer.slice(commandStart + line.length + 2);
}

test.describe('vitest run in the browser shell', () => {
  test('npm install and vitest run for vitest 4.1.11 and vite 8.0.16', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(420_000);
    await bootShell(page);
    await openShellTerminal(page);

    const setupLine = [
      'mkdir -p src',
      'rm -rf node_modules',
      'rm -f package-lock.json',
      `echo '{"name":"vitest-demo","version":"0.0.0","private":true,"type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"4.1.11"},"overrides":{"vite":"8.0.16"}}' > package.json`,
      `echo 'import { defineConfig } from "vitest/config"; export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });' > vitest.config.ts`,
      `echo 'export const sum = (a: number, b: number): number => a + b;' > src/sum.ts`,
      `echo 'import { expect, test } from "vitest"; import { sum } from "./sum"; test("adds", () => { expect(sum(1, 2)).toBe(3); }); test("fails", () => { expect(sum(1, 2)).toBe(4); });' > src/sum.test.ts`,
    ].join(' && ');
    await runTerminalLineSettled(page, setupLine, 30_000);
    expect(await terminalHistoryExitCode(page, setupLine)).toBe(0);

    const installOutput = await runLine(page, 'npm install', 180_000);
    expect(installOutput).toMatch(/npm: installed \d+ package\(s\)/);
    expect(await terminalHistoryExitCode(page, 'npm install')).toBe(0);

    const version = await runLine(page, 'cat node_modules/vite/package.json', 30_000);
    expect(version).toContain('"version": "8.0.16"');

    const vitestVersion = await runLine(page, 'vitest --version', 60_000);
    expect(vitestVersion, 'vitest --version').toContain('4.1.11');
    expect(await terminalHistoryExitCode(page, 'vitest --version')).toBe(0);

    const failing = await runLine(page, 'vitest run', 180_000);
    const failingCode = await terminalHistoryExitCode(page, 'vitest run');
    expect(failing, `vitest run exit ${failingCode}: ${JSON.stringify(failing)}`).toContain(
      'src/sum.test.ts',
    );
    expect(failing).toMatch(/1 passed/);
    expect(failing).toMatch(/1 failed/);
    expect(await terminalHistoryExitCode(page, 'vitest run')).toBe(1);

    const fixLine = `echo 'import { expect, test } from "vitest"; import { sum } from "./sum"; test("adds", () => { expect(sum(1, 2)).toBe(3); });' > src/sum.test.ts`;
    await runTerminalLineSettled(page, fixLine, 30_000);
    expect(await terminalHistoryExitCode(page, fixLine)).toBe(0);

    const passing = await runLine(page, 'vitest run', 180_000);
    expect(passing).toMatch(/1 passed/);
    expect(await terminalHistoryExitCode(page, 'vitest run')).toBe(0);

    const npmTest = await runLine(page, 'npm test', 180_000);
    expect(npmTest).toMatch(/1 passed/);
    expect(await terminalHistoryExitCode(page, 'npm test')).toBe(0);

    const verbose = await runLine(page, 'vitest run --reporter=verbose', 180_000);
    expect(verbose).toMatch(/1 passed/);
    expect(await terminalHistoryExitCode(page, 'vitest run --reporter=verbose')).toBe(0);

    const threads = await runLine(page, 'vitest run --pool=threads', 180_000);
    expect(threads).toMatch(/1 passed/);
    expect(await terminalHistoryExitCode(page, 'vitest run --pool=threads')).toBe(0);
  });
});
