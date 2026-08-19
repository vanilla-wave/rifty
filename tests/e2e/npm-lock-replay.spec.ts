/**
 * Faithful npm-authored lockfile replay — end-to-end epic proof (#254, #261).
 *
 * Both fixtures are REAL `package-lock.json` files written by the pinned
 * oracle toolchain (npm 11.17.0 / Node v24.16.0, committed under
 * `tests/e2e/fixtures/npm-lock-replay/`):
 *
 *  - #254: `vite@8.0.16` devDep — the lock carries rolldown's 15 platform
 *    bindings as entry `optionalDependencies`; replay must materialize the
 *    wasm32 binding (+ its @emnapi closure), skip natives, and `vite build`
 *    must complete.
 *  - #261: `@weavix/tracker-plugin-sdk@0.0.33` — a 6-package lock where three
 *    packages are reachable ONLY via `peerDependencies`; replay must
 *    materialize 6/6 and the SDK entry module must import in the runtime.
 *
 * Tarball acquisition rides the standard e2e path: entry `resolved` npmjs URLs
 * rewritten through the dev `/npm-registry` proxy (registry-fetch glue).
 */
import { type Page, expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

async function seedFixtureProject(
  page: Page,
  fixture: string,
  files: readonly string[],
): Promise<void> {
  // `node` needs the workbench package-tree readiness stamp, which only an
  // `npm install` publishes — run one against the starter manifest first, then
  // seed the fixture project over it and drop the starter tree.
  await runTerminalLineSettled(page, 'npm install', 180_000);
  const origin = new URL(page.url()).origin;
  const seedUrl = `${origin}/__e2e-fixtures/npm-lock-replay/seed.mjs`;
  await runTerminalLineSettled(
    page,
    `node -e "fetch('${seedUrl}').then(r=>r.text()).then(t=>{require('fs').writeFileSync('seed.mjs',t);console.log('GET-OK')})"`,
    60_000,
  );
  await expectTerminalContains(page, 'GET-OK', 10_000);
  // Seed OVER the live starter tree (node still needs its readiness), then
  // drop the starter node_modules so the next install is a pure lock replay.
  await runTerminalLineSettled(
    page,
    `node seed.mjs ${origin} ${fixture} ${files.join(' ')}`,
    60_000,
  );
  await expectTerminalContains(page, 'SEED-OK', 10_000);
  await runTerminalLineSettled(page, 'rm -rf node_modules seed.mjs', 60_000);
}

test.describe('npm-authored lockfile replay (epic faithful-npm-lock-replay)', () => {
  test('#254/#247: Vite 8 lock builds and an unresolved import stays a command failure', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(420_000);

    await bootProjectFiles(page);
    await openShellTerminal(page);
    await seedFixtureProject(page, 'vite8', [
      'package.json',
      'package-lock.json',
      'index.html',
      'src/main.js',
    ]);

    await runTerminalLineSettled(page, 'npm install', 300_000);
    await expectTerminalContains(page, /npm: installed \d+ package\(s\)/, 10_000);

    // #254 core: the cpu-admissible optional entry + its transitive closure
    // materialized; cpu-excluded natives did not.
    await runTerminalLineSettled(page, 'ls node_modules/@rolldown', 30_000);
    await expectTerminalContains(page, 'binding-wasm32-wasi', 10_000);
    await runTerminalLineSettled(page, 'ls node_modules/@emnapi', 30_000);
    await expectTerminalContains(page, 'wasi-threads', 10_000);
    const afterInstall = await terminalBuffer(page);
    expect(afterInstall).not.toContain('binding-linux-x64-gnu');

    await runTerminalLineSettled(page, 'npm run build', 180_000);
    await runTerminalLineSettled(page, 'cat dist/index.html', 30_000);
    await expectTerminalContains(page, /assets\/index-[^"]+\.js/, 10_000);
    const afterBuild = await terminalBuffer(page);
    expect(afterBuild).not.toContain('Cannot find native binding');

    await runTerminalLineSettled(
      page,
      `printf "import 'rifty-unresolved-import';\\ndocument.querySelector('#app').textContent = 'unreachable';\\n" > src/main.js`,
      30_000,
    );
    const failingBuild = 'vite build';
    await runTerminalLineSettled(page, failingBuild, 180_000);
    await expectTerminalContains(
      page,
      /\[vite\]: Rolldown failed to resolve import ["']rifty-unresolved-import["']/,
      10_000,
    );
    expect(await terminalHistoryExitCode(page, failingBuild)).not.toBe(0);

    await runTerminalLineSettled(page, `printf 'OWNER-ALIVE\\n'`, 30_000);
    await expectTerminalContains(page, 'OWNER-ALIVE', 10_000);
  });

  test('#261: peer-only lock entries replay 6/6 and the SDK entry module imports', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(300_000);

    await bootProjectFiles(page);
    await openShellTerminal(page);
    await seedFixtureProject(page, 'weavix', ['package.json', 'package-lock.json']);

    await runTerminalLineSettled(page, 'npm install', 180_000);
    await expectTerminalContains(page, /npm: installed 6 package\(s\)/, 10_000);

    await runTerminalLineSettled(page, 'ls node_modules/@weavix', 30_000);
    await expectTerminalContains(page, 'tracker-api-plugin', 10_000);
    const buffer = await terminalBuffer(page);
    for (const name of ['sdk-core', 'tracker-api-types', 'tracker-core', 'tracker-plugin-sdk']) {
      expect(buffer).toContain(name);
    }
    expect(buffer).not.toContain('required by @weavix/tracker-plugin-sdk but not installed');
    await runTerminalLineSettled(page, 'ls node_modules/valibot', 30_000);
    await expectTerminalContains(page, 'package.json', 10_000);

    // The peer-importing entry module loads in the runtime (I2): its static
    // imports (@weavix peers + valibot) must all resolve from the tree.
    await runTerminalLineSettled(
      page,
      `printf "import * as m from '@weavix/tracker-plugin-sdk';\\nconsole.log('SDK-LOAD-OK ' + typeof m);\\n" > check.mjs`,
      30_000,
    );
    await runTerminalLineSettled(page, 'node check.mjs', 60_000);
    await expectTerminalContains(page, 'SDK-LOAD-OK', 10_000);
    expect(await terminalBuffer(page)).not.toContain('SDK-LOAD-FAIL');
  });
});
