import { expect, test } from '@playwright/test';
import { bootOwner, execLine, gotoHarness, readOwnerFile, writeOwnerFile } from './fixtures.ts';

/**
 * Owner shell command routing, behaviorally against the REAL owner worker
 * (browser-unit lane, ADR-0196):
 *   1. `npm run <script>` executes the package.json script through the real
 *      shell (runPackageScript → scriptShell.run), streaming its output.
 *   2. `vite` is NOT an owner-registered command, so with no installed
 *      node_modules/.bin/vite it is an honest 127.
 *   3. a declarative node-cli project keeps the package script body on the
 *      same owner-backed shell path.
 */

test('npm scripts route through the real shell; vite stays package-owned; node-cli dev wrapper', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-shell-routing',
    persistence: 'ephemeral',
    plan: {
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'cli-report',
      templateId: 'cli-report',
      files: {
        '/package.json': `${JSON.stringify(
          {
            name: 'bu-shell-routing',
            version: '0.0.0',
            private: true,
            type: 'module',
            scripts: { hello: 'echo from-package-script', dev: 'echo cli-dev-body-ran' },
          },
          null,
          2,
        )}\n`,
        '/src/cli.js': "console.log('cli-project-run')\n",
      },
      firstMaterialization: { kind: 'install' },
      entryPath: '/src/cli.js',
    },
  });

  // 1. Plain script → real shell execution of the script body.
  const hello = await execLine(page, 'npm run hello');
  expect(hello.exit).toBe(0);
  expect(hello.out).toContain('from-package-script');

  // 2. No owner `vite` command: without node_modules/.bin the miss is honest.
  const vite = await execLine(page, 'vite --version');
  expect(vite.exit).toBe(127);
  expect(vite.out).toContain('vite: command not found');

  // 3. The declarative node-cli plan owns the command policy from project open.
  const dev = await execLine(page, 'npm run dev');
  expect(dev.exit).toBe(0);
  expect(dev.out).toContain('cli-dev-body-ran');
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

  expect(installed.exit, installed.out).toBe(0);
  expect(installed.out).not.toContain('package acquisition config missing');
  expect(installed.out).toContain('npm: no dependencies to install');
});

test('terminal git preflights every worktree target through the owner namespace authority', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, { workspaceId: 'bu-git-claim-preflight', hiddenEmptyBoot: true });
  expect((await execLine(page, 'mkdir repo')).exit).toBe(0);
  expect((await execLine(page, 'cd repo')).exit).toBe(0);
  expect((await execLine(page, 'git init')).exit).toBe(0);
  await writeOwnerFile(
    page,
    '/scratch/repo/claim.patch',
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

  expect(applied.exit, applied.out).toBe(128);
  expect(applied.out).toContain('EPERM');
  expect((await readOwnerFile(page, '/scratch/repo/ordinary.txt')).ok).toBe(false);
  expect(
    (await readOwnerFile(page, '/scratch/repo/node_modules/.rifty-install-stamp.json')).ok,
  ).toBe(false);
});

test('instant preset open completes snapshot restore and template seeds before terminal use', async ({
  page,
}) => {
  await gotoHarness(page);
  let snapshotResponseCompleted = false;
  await page.route('**/snapshots/typescript-node-modules.json.gz', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
    snapshotResponseCompleted = true;
  });

  await bootOwner(page, {
    workspaceId: 'bu-restore-gate',
    template: 'typescript',
    starter: 'typescript',
    setup: 'instant',
    persistence: 'ephemeral',
  });

  // The sealed companion publishes the project only after a valid snapshot is
  // restored and the project tree is ready. No pre-session progress is
  // relabelled as output from this later terminal command.
  expect(snapshotResponseCompleted).toBe(true);
  const ls = await execLine(page, 'ls node_modules/typescript');
  expect(ls.exit, ls.out).toBe(0);
  expect(ls.out).toContain('package.json');
  expect(ls.out).not.toContain('restoring project dependencies');

  // The snapshot replaced node_modules wholesale; template-owned node_modules
  // seed files (the @rifty/example-types .d.ts fixture) must be re-asserted
  // after the restore (seedTemplateNodeModulesFiles runs last).
  const seeds = await execLine(page, 'ls node_modules/@rifty/example-types');
  expect(seeds.exit).toBe(0);
  expect(seeds.out).toContain('index.d.ts');
});

test('direct TypeScript Vite boot reasserts a deleted template seed before child spawn', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-vite-boot-seed',
    template: 'typescript',
    starter: 'typescript',
    setup: 'instant',
    persistence: 'ephemeral',
  });

  expect((await execLine(page, 'ls node_modules/typescript')).exit).toBe(0);

  await writeOwnerFile(
    page,
    '/scratch/.rifty-vite-seed-probe.mjs',
    [
      "import { readFileSync } from 'node:fs';",
      "const seed = readFileSync('/node_modules/@rifty/example-types/index.d.ts', 'utf8');",
      "console.log('seed-visible-before-spawn=' + seed.includes('LibraryShape'));",
      "console.log('vite-argv=' + process.argv.slice(2).join(','));",
      '',
    ].join('\n'),
  );
  await writeOwnerFile(
    page,
    '/scratch/node_modules/.bin/vite',
    "#!/usr/bin/env node\nimport('/.rifty-vite-seed-probe.mjs');\n",
  );

  const removed = await execLine(page, 'rm node_modules/@rifty/example-types/index.d.ts');
  expect(removed.exit).toBe(0);
  expect(
    (await readOwnerFile(page, '/scratch/node_modules/@rifty/example-types/index.d.ts')).ok,
  ).toBe(false);

  const boot = await execLine(page, 'vite --port 5174');
  expect(boot.exit, boot.out).toBe(0);
  expect(boot.out).toContain('seed-visible-before-spawn=true');
  expect(boot.out).toContain('vite-argv=--port,5174');
  expect(
    (await readOwnerFile(page, '/scratch/node_modules/@rifty/example-types/index.d.ts')).ok,
  ).toBe(true);
});
