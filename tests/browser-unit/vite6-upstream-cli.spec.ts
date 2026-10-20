import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { expect, test } from '@playwright/test';
import { browserRegistryPackages } from '../integration/browser-registry-fixture.mjs';
import { startInstalledRegistry } from '../integration/installed-registry.mjs';
import { bootOwner, closeOwner, execLine, gotoHarness } from './fixtures.ts';

// I6 only: reach the real Vite 6 build action. This is not a verified Vite 6 lane.
test('Vite 6.4.4 npm install and npx build reach the upstream CLI', async ({ page, context }) => {
  const packages = await browserRegistryPackages(process.cwd());
  for (const [name, version] of [
    ['vite', '6.4.4'],
    ['esbuild-wasm', '0.25.12'],
  ] as const) {
    const tarball = fileURLToPath(
      new URL(
        `../integration/fixtures/registry/esbuild-upstream/${name}-${version}.tgz`,
        import.meta.url,
      ),
    );
    const bytes = readFileSync(tarball);
    packages.set(name, {
      name,
      tarball,
      manifest: JSON.parse(
        execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }),
      ),
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      shasum: createHash('sha1').update(bytes).digest('hex'),
    });
  }
  const root = mkdtempSync(join(tmpdir(), 'rifty-vite6-cli-'));
  const registry = await startInstalledRegistry(packages);
  let ownerOpen = false;
  try {
    // Same upstream wasm twins on Node, without host-native optional binaries.
    for (const [name, entry] of packages) {
      if (name === 'esbuild' || name === 'rollup') continue;
      const installedName =
        name === 'esbuild-wasm' ? 'esbuild' : name === '@rollup/wasm-node' ? 'rollup' : name;
      const destination = join(root, 'node_modules', installedName);
      mkdirSync(destination, { recursive: true });
      execFileSync('tar', ['-xzf', entry.tarball, '--strip-components=1', '-C', destination]);
    }
    mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
    symlinkSync('../vite/bin/vite.js', join(root, 'node_modules/.bin/vite'));
    const manifest = JSON.stringify({
      name: 'vite6-cli',
      private: true,
      type: 'module',
      dependencies: { vite: '6.4.4' },
    });
    writeFileSync(join(root, 'package.json'), manifest);
    const oracle = spawnSync('npx', ['--no-install', 'vite', 'build'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
    });
    if (oracle.error) throw oracle.error;
    expect(oracle.status, oracle.stderr).toBe(1);
    expect(oracle.stdout).toContain('vite v6.4.4 building for production');
    expect(oracle.stderr).toContain('Could not resolve entry module "index.html"');
    await context.route('**/npm-registry/**', async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: registry.origin + url.pathname.slice('/npm-registry'.length) + url.search,
      });
      await route.fulfill({ response });
    });
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: 'bu-vite6-upstream-cli',
      persistence: 'ephemeral',
      plan: {
        kind: 'node-cli',
        id: 'scratch',
        starterId: 'vite6-cli',
        templateId: 'browser-unit:vite6-cli',
        files: { '/package.json': manifest, '/unused.cjs': '' },
        firstMaterialization: { kind: 'install' },
        entryPath: '/unused.cjs',
      },
    });
    ownerOpen = true;
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    const cli = await execLine(page, 'npx vite build');
    expect(cli.exit, cli.out).toBe(oracle.status);
    expect(stripVTControlCharacters(cli.out)).toContain('vite v6.4.4 building for production');
    expect(cli.out).toContain('Could not resolve entry module "index.html"');
  } finally {
    if (ownerOpen) await closeOwner(page);
    await registry.close();
    rmSync(root, { recursive: true, force: true });
  }
});
