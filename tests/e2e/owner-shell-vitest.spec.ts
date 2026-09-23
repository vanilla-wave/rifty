import { expect, test } from '@playwright/test';
import { vitestProject } from './fixtures/vitest-run/project.ts';
import {
  bootShell,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

test('Vitest runs TypeScript tests with real results in both pools', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'workspace owner requires Chromium COI/SAB');
  test.setTimeout(600_000);
  await bootShell(page);
  await openShellTerminal(page);
  const setup = [
    'rm -rf node_modules package-lock.json',
    'mkdir -p src',
    ...Object.entries(vitestProject).map(
      ([path, source]) => `echo '${source.replaceAll("'", "'\\''")}' > ${path}`,
    ),
  ].join(' && ');
  await runTerminalLineSettled(page, setup, 30_000);
  expect(await terminalHistoryExitCode(page, setup)).toBe(0);
  await runTerminalLineSettled(page, 'npm install', 180_000);
  expect(await terminalHistoryExitCode(page, 'npm install')).toBe(0);
  const installed = await terminalBuffer(page);
  expect(installed).toMatch(/npm: installed \d+ package\(s\)/);
  expect(installed).toContain('lightningcss-wasm@1.32.0');
  const inspect = `node -e 'const fs=require("fs");const lock=JSON.parse(fs.readFileSync("package-lock.json","utf8"));const v=Object.entries(lock.packages).filter(([p])=>p.endsWith("node_modules/vite")).map(([p,v])=>p+"@"+v.version);console.log("VITE-TREE="+JSON.stringify(v));console.log("VITEST="+require("vitest/package.json").version);console.log("WASM="+fs.existsSync("node_modules/@rolldown/binding-wasm32-wasi/package.json"))'`;
  await runTerminalLineSettled(page, inspect, 60_000);
  expect(await terminalHistoryExitCode(page, inspect)).toBe(0);
  const result = await terminalBuffer(page);
  expect(result).toContain('VITE-TREE=["node_modules/vite@8.0.16"]');
  expect(result).toContain('VITEST=4.1.11');
  expect(result).toContain('WASM=true');
  for (const failing of [true, false]) {
    if (!failing) {
      const fixed = vitestProject['src/sum.test.ts'].replace('toBe(4)', 'toBe(3)');
      await runTerminalLineSettled(
        page,
        `echo '${fixed.replaceAll("'", "'\\''")}' > src/sum.test.ts`,
        30_000,
      );
    }
    for (const command of [
      'vitest run',
      'vitest run --pool=forks',
      'vitest run --pool=threads',
      'vitest run --reporter=verbose',
      'npm test',
    ]) {
      await runTerminalLineSettled(page, command, 90_000);
      const buffer = await terminalBuffer(page);
      const start = buffer.lastIndexOf(`> ${command}`);
      expect(start, `missing command echo: ${command}`).toBeGreaterThanOrEqual(0);
      const output = buffer.slice(start + command.length + 2);
      expect(await terminalHistoryExitCode(page, command), output).toBe(failing ? 1 : 0);
      // Native default reporter can omit a fast passing file; failures/verbose list it.
      if (failing || command.includes('verbose')) expect(output).toContain('src/sum.test.ts');
      expect(output).not.toContain('CONFIG_INCLUDE_WAS_IGNORED');
      expect(output).toMatch(failing ? /1 failed/ : /2 passed/);
      if (failing) {
        expect(output).toMatch(/1 passed/);
        expect(output).toContain('expected 3 to be 4');
      }
      if (command.includes('verbose')) {
        expect(output).toContain('adds numbers');
        expect(output).toContain('reveals a failing expectation');
      }
    }
  }
});
