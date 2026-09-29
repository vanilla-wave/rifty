/**
 * npm's bare-version override pins a transitive package in the browser shell
 * (I1, ADR-0451): the goal scenario manifest — vitest 4.1.11 with
 * `"overrides": {"vite": "8.0.16"}` — installs against the real registry and
 * locks exactly the vite entries npm 11.17.0 locks for it (probe row
 * `scenario-vitest-vite`). The rifty `vite@8.0.16` spelling runs first on the
 * same page and keeps working.
 */
import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import {
  bootShell,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLineSettled,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

interface ScenarioRow {
  readonly id: string;
  readonly manifest: Readonly<{ overrides: Readonly<Record<string, string>> }>;
  readonly entries: Readonly<Record<string, Readonly<{ version: string }>>>;
}

const oracle = JSON.parse(
  readFileSync(
    new URL(
      '../../docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { readonly npm: string; readonly installs: readonly ScenarioRow[] };
const scenario = oracle.installs.find((row) => row.id === 'scenario-vitest-vite');
if (!scenario) throw new Error('oracle scenario row missing');
// `path@version` list: no double quotes, so it embeds in a `node -e "…"` line.
const npmViteEntries = Object.entries(scenario.entries)
  .map(([path, entry]) => `${path}@${entry.version}`)
  .join(',');

async function installAndMatchNpm(page: Page, overrideValue: string, marker: string) {
  const manifest = JSON.stringify({ ...scenario?.manifest, overrides: { vite: overrideValue } });
  const install = `rm -rf node_modules package-lock.json && echo '${manifest}' > package.json && npm install`;
  await runTerminalLineSettled(page, install, 300_000);
  expect(
    await terminalHistoryExitCode(page, install),
    `npm install with vite ${overrideValue}`,
  ).toBe(0);

  const verification = [
    "const fs=require('node:fs');",
    "const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));",
    "const got=Object.entries(lock.packages).filter(([p])=>p.endsWith('node_modules/vite')).map(([p,e])=>p+'@'+e.version).join(',');",
    `if(got!=='${npmViteEntries}')throw Error('vite lock entries '+got);`,
    "const dir=JSON.parse(fs.readFileSync('node_modules/vite/package.json','utf8'));",
    `if('node_modules/vite@'+dir.version!=='${npmViteEntries}')throw Error('vite dir '+dir.version);`,
    "if(!fs.existsSync('node_modules/vitest/package.json'))throw Error('vitest missing');",
    `console.log('${marker}')`,
  ].join('');
  const verify = `node -e "${verification}"`;
  await runTerminalLineSettled(page, verify, 60_000);
  expect(await terminalHistoryExitCode(page, verify), verify).toBe(0);
  await expectTerminalContains(page, marker, 10_000);
}

test('npm bare-version override pins vitest’s vite edge like npm 11.17.0', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'browser shell requires Chromium COI/SAB');
  test.setTimeout(900_000);
  expect(oracle.npm).toBe('11.17.0');

  await bootShell(page);
  await openShellTerminal(page);

  const npmSpelling = scenario.manifest.overrides.vite;
  if (npmSpelling === undefined) throw new Error('oracle scenario has no vite override');
  await installAndMatchNpm(page, `vite@${npmSpelling}`, 'RIFTY-SPELLING-TREE-OK');
  await installAndMatchNpm(page, npmSpelling, 'NPM-SPELLING-TREE-OK');
});
