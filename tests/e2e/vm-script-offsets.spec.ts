import { expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLineSettled,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

test('vm script offsets reach delayed stacks in a Chromium Node child', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'browser Node child requires Chromium COI/SAB');
  test.setTimeout(120_000);
  await bootProjectFiles(page);
  await openShellTerminal(page);

  const source = [
    'import vm from "node:vm";',
    'const f=vm.runInThisContext("() => new Error().stack",',
    '{filename:"/virtual/offset.js",lineOffset:10,columnOffset:-20});',
    'console.log("VM-OFFSET "+f().match(/\\/virtual\\/offset\\.js:-?\\d+:-?\\d+/)[0]);',
  ].join('');
  const seed = `echo '${source}' > vm-offsets.mjs`;
  await runTerminalLineSettled(page, seed, 30_000);
  expect(await terminalHistoryExitCode(page, seed)).toBe(0);

  await runTerminalLineSettled(page, 'node vm-offsets.mjs', 60_000);
  expect(await terminalHistoryExitCode(page, 'node vm-offsets.mjs')).toBe(0);
  await expectTerminalContains(page, 'VM-OFFSET /virtual/offset.js:11:-13', 10_000);
});
