import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness } from './fixtures.ts';

const version = '8.15.0';
const archivePath = fileURLToPath(
  new URL(`../integration/fixtures/registry/local-npx/acorn-${version}.tgz`, import.meta.url),
);
const archive = readFileSync(archivePath);
const source = 'const value = 7;\n';
for (const nested of [false, true]) {
  test(`local npx resolves installed bin and forwards arguments: nested=${nested}`, async ({
    page,
  }) => {
    test.fail(true, 'local npx is not implemented yet');
    const root = mkdtempSync(join(tmpdir(), 'rifty-npx-'));
    let opened = false;
    try {
      const packageRoot = join(root, 'node_modules/acorn');
      mkdirSync(packageRoot, { recursive: true });
      execFileSync('tar', ['-xzf', archivePath, '--strip-components=1', '-C', packageRoot]);
      mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
      symlinkSync('../acorn/bin/acorn', join(root, 'node_modules/.bin/acorn'));
      mkdirSync(join(root, 'src'));
      mkdirSync(join(root, 'nested'));
      writeFileSync(join(root, 'src/a b.js'), source);
      writeFileSync(join(root, 'package.json'), '{"name":"npx-fixture","private":true}');
      const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
      const args = nested
        ? ['--no-install', 'acorn', '../src/a b.js', '--ecma2020', '--compact']
        : ['--no-install', 'acorn', '--help'];
      const oracle = execFileSync('npx', args, {
        cwd: nested ? join(root, 'nested') : root,
        encoding: 'utf8',
        timeout: 30_000,
      });
      const registryRequests: string[] = [];
      await page.route('**/npm-registry/**', async (route) => {
        registryRequests.push(route.request().url());
        if (route.request().url().endsWith('.tgz')) {
          await route.fulfill({ body: archive, contentType: 'application/octet-stream' });
          return;
        }
        await route.fulfill({
          json: {
            name: 'acorn',
            'dist-tags': { latest: version },
            versions: {
              [version]: {
                ...manifest,
                dist: {
                  tarball: new URL('./upstream.tgz', route.request().url()).href,
                  integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
                },
              },
            },
          },
        });
      });
      await gotoHarness(page);
      await bootOwner(page, {
        workspaceId: `bu-local-npx-${nested}`,
        persistence: 'ephemeral',
        plan: {
          kind: 'node-cli',
          id: 'scratch',
          starterId: 'npx',
          templateId: 'browser-unit:npx',
          files: {
            '/package.json': '{"name":"npx-fixture","private":true}',
            '/probe.cjs': '',
            '/src/a b.js': source,
            '/nested/.keep': '',
          },
          firstMaterialization: { kind: 'install' },
          entryPath: '/probe.cjs',
        },
      });
      opened = true;
      const install = await execLine(page, `npm install acorn@${version}`);
      expect(install.exit, install.out).toBe(0);
      // Distinguish npx's missing selection from a missing or broken local executable.
      const direct = await execLine(page, 'acorn --help');
      expect(direct.exit, direct.out).toBe(0);
      expect(direct.out).toContain('usage: acorn');
      if (nested) expect((await execLine(page, 'cd nested')).exit).toBe(0);
      const before = registryRequests.length;
      const run = await execLine(
        page,
        nested
          ? "npx --no-install acorn '../src/a b.js' --ecma2020 --compact | cat"
          : 'npx acorn --help',
      );
      expect(run.exit, run.out).toBe(0);
      expect(run.out.replaceAll('\r\n', '\n')).toBe(oracle);
      expect(registryRequests).toHaveLength(before);
    } finally {
      if (opened) await closeOwner(page);
      rmSync(root, { recursive: true, force: true });
    }
  });
}
