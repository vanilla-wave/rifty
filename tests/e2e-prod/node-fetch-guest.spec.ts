import { expect, test } from '@playwright/test';
import { runNodeOracle } from '../browser-unit/fixtures/message-port-ref-cases.ts';
import { fetchGuestCases } from '../browser-unit/fixtures/node-fetch-guest-cases.ts';
import {
  bootProjectFiles,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from '../e2e/helpers/playground.ts';

test('production Node Fetch classes preserve names and platform state across bundles', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const cases = fetchGuestCases.filter((f) =>
    ['headers-and-identity', 'vm-header-record', 'custom-tee-state'].includes(f.name),
  );
  const expected: string[] = [];
  for (const fixture of cases) {
    const oracle = await runNodeOracle(fixture.source);
    expect(oracle.code, oracle.stderr).toBe(0);
    expected.push(
      ...oracle.stdout
        .replaceAll('\r', '')
        .split('\n')
        .filter((line) => line.startsWith('FETCH|')),
    );
  }
  await bootProjectFiles(page);
  await expectViteDevServerReady(page, 5173, 120_000);
  await openShellTerminal(page);
  for (const fixture of cases) {
    const name = `fetch-${fixture.name}.cjs`;
    const bytes = Buffer.from(fixture.source).toString('base64');
    await runTerminalLineSettled(
      page,
      `node -e "require('fs').writeFileSync('${name}',Buffer.from('${bytes}','base64'))"`,
    );
    const command = `node ${name}`;
    await runTerminalLineSettled(page, command, 60_000);
    expect(await terminalHistoryExitCode(page, command)).toBe(0);
  }
  const actual = (await terminalBuffer(page))
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line.startsWith('FETCH|'));
  expect(actual).toEqual(expected);
});
