import { expect, test } from '@playwright/test';
import { bootOwner, execLine, gotoHarness, setDevConfig, writeOwnerFile } from './fixtures.ts';

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

test('instant preset restore gates the run; template node_modules seeds re-asserted post-restore', async ({
  page,
}) => {
  await gotoHarness(page);
  // Fresh owner: this test mutates /scratch node_modules via the instant restore.
  await bootOwner(page, { workspaceId: 'bu-restore-gate', hiddenEmptyBoot: true });

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
