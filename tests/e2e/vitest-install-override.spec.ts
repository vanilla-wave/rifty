import { expect, test } from '@playwright/test';
import {
  bootShell,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLineSettled,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

test('Vitest 4.1.11 installs Vite 8.0.16 from the npm override', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'browser shell requires Chromium COI/SAB');
  test.setTimeout(480_000);

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
});
