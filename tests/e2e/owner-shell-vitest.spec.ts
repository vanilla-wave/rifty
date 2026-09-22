import { expect, test } from '@playwright/test';
import {
  bootShell,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

test('npm-spelled override installs the exact Vitest/Vite pair', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'workspace owner requires Chromium COI/SAB');
  test.setTimeout(300_000);
  await bootShell(page);
  await openShellTerminal(page);
  const setup = [
    'rm -rf node_modules package-lock.json',
    `echo '{"name":"vitest-demo","version":"1.0.0","type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"4.1.11"},"overrides":{"vite":"8.0.16"}}' > package.json`,
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
});
