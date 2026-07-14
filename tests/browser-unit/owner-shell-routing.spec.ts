import { expect, test } from '@playwright/test';
import {
  bootOwner,
  execLine,
  gotoHarness,
  readOwnerFile,
  setDevConfig,
  writeOwnerFile,
} from './fixtures.ts';

/**
 * Owner shell command routing, behaviorally against the REAL owner worker
 * (browser-unit lane, ADR-0196) — contracts formerly source-grep-pinned in
 * real-vite-bootstrap.test.ts:
 *   1. `npm run <script>` executes the package.json script through the real
 *      shell (runPackageScript → scriptShell.run), streaming its output.
 *   2. `vite` is NOT an owner-registered command — nothing shadows
 *      node_modules/.bin/vite, so with no install it is an honest 127.
 *   3. node-cli templates: the dev-script alias runs the package.json command
 *      wrapped in the `cli: running <name>` / `[cli] completed with exit code N`
 *      lifecycle lines (pty:dev-config switches the active template).
 */

test('npm scripts route through the real shell; vite unshadowed; node-cli dev wrapper', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, { workspaceId: 'bu-shell-routing', hiddenEmptyBoot: true });

  // No package.json is seeded on a hidden-empty boot — provide the scripts.
  await writeOwnerFile(
    page,
    '/scratch/package.json',
    `${JSON.stringify(
      {
        name: 'bu-shell-routing',
        version: '0.0.0',
        scripts: { hello: 'echo from-package-script', dev: 'echo cli-dev-body-ran' },
      },
      null,
      2,
    )}\n`,
  );

  // 1. Plain script → real shell execution of the script body.
  const hello = await execLine(page, 'npm run hello');
  expect(hello.exit).toBe(0);
  expect(hello.out).toContain('from-package-script');

  // 2. No owner `vite` command: without node_modules/.bin the miss is honest.
  const vite = await execLine(page, 'vite --version');
  expect(vite.exit).toBe(127);
  expect(vite.out).toContain('vite: command not found');

  // 3. node-cli lifecycle: switch the active dev config to the cli-report
  //    template, then run its dev alias — the wrapper prints the lifecycle
  //    lines around the REAL script body (from package.json, via the shell).
  await setDevConfig(page, { templateId: 'cli-report', slug: 'scratch', setup: 'from-scratch' });
  const dev = await execLine(page, 'npm run dev');
  expect(dev.exit).toBe(0);
  expect(dev.out).toContain('cli: running CLI report');
  expect(dev.out).toContain('cli-dev-body-ran');
  expect(dev.out).toContain('[cli] completed with exit code 0');
});

test('terminal npm install keeps an arbitrary nested cwd outside the active preset config', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, { workspaceId: 'bu-nested-npm', hiddenEmptyBoot: true });
  await writeOwnerFile(
    page,
    '/scratch/nested/package.json',
    `${JSON.stringify({ name: 'nested', version: '0.0.0', private: true }, null, 2)}\n`,
  );

  const cd = await execLine(page, 'cd nested');
  expect(cd.exit).toBe(0);
  const installed = await execLine(page, 'npm install');

  expect(installed.exit).toBe(0);
  expect(installed.out).not.toContain('package acquisition config missing');
  expect(installed.out).toContain('npm: no dependencies to install');
});

test('terminal git preflights every worktree target through the owner namespace authority', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, { workspaceId: 'bu-git-claim-preflight', hiddenEmptyBoot: true });
  expect((await execLine(page, 'git init')).exit).toBe(0);
  await writeOwnerFile(
    page,
    '/scratch/claim.patch',
    [
      'diff --git a/ordinary.txt b/ordinary.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/ordinary.txt',
      '@@ -0,0 +1 @@',
      '+ordinary',
      'diff --git a/node_modules/.rifty-install-stamp.json b/node_modules/.rifty-install-stamp.json',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/node_modules/.rifty-install-stamp.json',
      '@@ -0,0 +1 @@',
      '+forged',
      '',
    ].join('\n'),
  );

  const applied = await execLine(page, 'git apply claim.patch');

  expect(applied.exit).toBe(128);
  expect(applied.out).toContain('EPERM');
  expect((await readOwnerFile(page, '/scratch/ordinary.txt')).ok).toBe(false);
  expect((await readOwnerFile(page, '/scratch/node_modules/.rifty-install-stamp.json')).ok).toBe(
    false,
  );
});

test('instant preset restore gates the run; template node_modules seeds re-asserted post-restore', async ({
  page,
}) => {
  await gotoHarness(page);
  // Fresh owner: this test mutates /scratch node_modules via the instant restore.
  await bootOwner(page, { workspaceId: 'bu-restore-gate', hiddenEmptyBoot: true });

  // Hold the snapshot response ~600ms (latency shaping only — the REAL bytes
  // still flow through the REAL restore path). The stamp rework (ADR-0187
  // Corrected) took the awaited OPFS drains out of the restore, so on a fast
  // host the whole restore can beat the 250ms slow-progress threshold and the
  // exec below would no longer provably overlap the in-flight restore.
  await page.route('**/snapshots/typescript-node-modules.json.gz', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });

  // Switch to the instant typescript preset: prepareActiveDevConfigDeps starts
  // restoring the baked snapshot ASYNCHRONOUSLY (the ack must not wait for it).
  await setDevConfig(page, { templateId: 'typescript', slug: 'scratch', setup: 'instant' });

  // Issued IMMEDIATELY after the config ack, while the multi-MB restore is in
  // flight: the per-run beforeRun gate must hold the command until deps landed,
  // streaming the slow-restore progress line into THIS run's output.
  const ls = await execLine(page, 'ls node_modules/typescript');
  expect(ls.exit).toBe(0);
  expect(ls.out).toContain('package.json');
  expect(ls.out).toContain('restoring project dependencies');

  // The snapshot replaced node_modules wholesale; template-owned node_modules
  // seed files (the @rifty/example-types .d.ts fixture) must be re-asserted
  // after the restore (seedTemplateNodeModulesFiles runs last).
  const seeds = await execLine(page, 'ls node_modules/@rifty/example-types');
  expect(seeds.exit).toBe(0);
  expect(seeds.out).toContain('index.d.ts');
});

test('TypeScript Vite dev bin sees a deleted template node_modules seed before child spawn', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, { workspaceId: 'bu-vite-dev-seed', hiddenEmptyBoot: true });

  await setDevConfig(page, { templateId: 'typescript', slug: 'scratch', setup: 'instant' });
  // Cross the real restore gate first; the regression is a later user deletion,
  // after config preparation already completed.
  expect((await execLine(page, 'ls node_modules/typescript')).exit).toBe(0);

  await writeOwnerFile(
    page,
    '/scratch/node_modules/.bin/seed-probe',
    "#!/usr/bin/env node\nimport('../seed-probe/index.mjs');\n",
  );
  await writeOwnerFile(
    page,
    '/scratch/node_modules/seed-probe/index.mjs',
    [
      "import { readFileSync } from 'node:fs';",
      "const seed = readFileSync('/scratch/node_modules/@rifty/example-types/index.d.ts', 'utf8');",
      "console.log('seed-visible-before-spawn=' + seed.includes('LibraryShape'));",
      '',
    ].join('\n'),
  );
  await writeOwnerFile(
    page,
    '/scratch/package.json',
    `${JSON.stringify(
      {
        name: 'bu-vite-dev-seed',
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: { dev: 'seed-probe' },
      },
      null,
      2,
    )}\n`,
  );

  const removed = await execLine(page, 'rm node_modules/@rifty/example-types/index.d.ts');
  expect(removed.exit).toBe(0);
  expect(
    (await readOwnerFile(page, '/scratch/node_modules/@rifty/example-types/index.d.ts')).ok,
  ).toBe(false);

  // `dev` is a Vite-runtime lifecycle alias, but deliberately dispatches a
  // finite real .bin child so it can prove the seed existed before spawn.
  const dev = await execLine(page, 'npm run dev');
  expect(dev.exit, dev.out).toBe(0);
  expect(dev.out).toContain('seed-visible-before-spawn=true');
  expect(
    (await readOwnerFile(page, '/scratch/node_modules/@rifty/example-types/index.d.ts')).ok,
  ).toBe(true);
});
