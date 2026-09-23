import { type Page, expect, test } from '@playwright/test';
import {
  bootShell,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

async function runCommand(
  page: Page,
  line: string,
  timeout: number,
): Promise<{
  output: string;
  exitCode: number;
}> {
  await runTerminalLineSettled(page, line, timeout);
  const buffer = await terminalBuffer(page);
  const start = buffer.lastIndexOf(`> ${line}`);
  if (start < 0) throw new Error(`Terminal command echo missing for ${line}`);
  return {
    output: buffer.slice(start + line.length + 2),
    exitCode: await terminalHistoryExitCode(page, line),
  };
}

function expectFailedReport(output: string): void {
  expect(output).toMatch(/RUN\s+v4\.1\.11/u);
  expect(output).toContain('src/sum.test.ts');
  expect(output).toContain('sum fails');
  expect(output).toMatch(/Test Files\s+1 failed\s+\(1\)/u);
  expect(output).toMatch(/Tests\s+1 failed\s+\|\s+1 passed\s+\(2\)/u);
  expect(output).toContain('expected 3 to be 4');
  expect(output).toMatch(/- Expected[\s\S]*\+ Received[\s\S]*- 4[\s\S]*\+ 3/u);
  expect(output).not.toContain('CONFIG-IGNORED');
}

function expectPassedReport(output: string): void {
  expect(output).toMatch(/RUN\s+v4\.1\.11/u);
  expect(output).toMatch(/Test Files\s+1 passed\s+\(1\)/u);
  expect(output).toMatch(/Tests\s+2 passed\s+\(2\)/u);
  expect(output).not.toContain('CONFIG-IGNORED');
}

test('Vitest 4.1.11 and Vite 8.0.16 install and run TS tests on both pools', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'browser shell requires Chromium COI/SAB');
  test.setTimeout(900_000);

  await bootShell(page);
  await openShellTerminal(page);

  const manifest = JSON.stringify({
    name: 'vitest-browser-contract',
    private: true,
    type: 'module',
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '4.1.11' },
    overrides: { vite: '8.0.16' },
  });
  const seed = `rm -rf node_modules package-lock.json && echo '${manifest}' > package.json`;
  await runTerminalLineSettled(page, seed, 30_000);
  expect(await terminalHistoryExitCode(page, seed)).toBe(0);

  await runTerminalLineSettled(page, 'npm install', 300_000);
  expect(await terminalHistoryExitCode(page, 'npm install')).toBe(0);

  const verificationSource = [
    "const fs=require('node:fs');",
    "const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));",
    "const vite=read('node_modules/vite/package.json');",
    "const vitest=read('node_modules/vitest/package.json');",
    "if(vite.version!=='8.0.16'||vitest.version!=='4.1.11')throw Error('wrong package versions');",
    "if(fs.existsSync('node_modules/vitest/node_modules/vite'))throw Error('nested vite');",
    "if(!fs.existsSync('node_modules/@rolldown/binding-wasm32-wasi/package.json'))throw Error('missing wasm32 binding');",
    "console.log('VITEST-INSTALL-OK')",
  ].join('');
  const verify = `node -e "${verificationSource}"`;
  await runTerminalLineSettled(page, verify, 60_000);
  expect(await terminalHistoryExitCode(page, verify)).toBe(0);
  await expectTerminalContains(page, 'VITEST-INSTALL-OK', 10_000);

  const failingTest = [
    'import { expect, test } from "vitest";',
    'import { sum } from "./sum";',
    'test("sum passes", () => expect(sum(1, 2)).toBe(3));',
    'test("sum fails", () => expect(sum(1, 2)).toBe(4));',
  ].join(' ');
  const fixedTest = failingTest.replace(
    'test("sum fails", () => expect(sum(1, 2)).toBe(4));',
    'test("sum fixed", () => expect(sum(1, 2)).toBe(3));',
  );
  const config =
    'import { defineConfig } from "vitest/config"; export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });';
  const setupFiles = [
    'mkdir -p src',
    `echo '${config}' > vitest.config.ts`,
    "echo 'export const sum = (a: number, b: number): number => a + b;' > src/sum.ts",
    `echo '${failingTest}' > src/sum.test.ts`,
    'echo \'import { test } from "vitest"; test("CONFIG-IGNORED", () => { throw Error("CONFIG-IGNORED"); });\' > outside.test.ts',
  ].join(' && ');
  expect((await runCommand(page, setupFiles, 30_000)).exitCode).toBe(0);

  for (const command of [
    'vitest run',
    'npm test',
    'vitest run --reporter=verbose',
    'vitest run --pool=threads',
  ]) {
    const result = await runCommand(page, command, 180_000);
    expect(result.exitCode, `${command}\n${result.output}`).toBe(1);
    expectFailedReport(result.output);
    if (command.includes('verbose')) expect(result.output).toContain('sum passes');
    if (command === 'npm test') expect(result.output).toContain('vitest run');
  }

  const fix = `echo '${fixedTest}' > src/sum.test.ts`;
  expect((await runCommand(page, fix, 30_000)).exitCode).toBe(0);
  for (const command of [
    'vitest run',
    'npm test',
    'vitest run --reporter=verbose',
    'vitest run --pool=threads',
  ]) {
    const result = await runCommand(page, command, 180_000);
    expect(result.exitCode, `${command}\n${result.output}`).toBe(0);
    expectPassedReport(result.output);
    if (command.includes('verbose')) {
      expect(result.output).toContain('sum passes');
      expect(result.output).toContain('sum fixed');
    }
    if (command === 'npm test') expect(result.output).toContain('vitest run');
  }
});
