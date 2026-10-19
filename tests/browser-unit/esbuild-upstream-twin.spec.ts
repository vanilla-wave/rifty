import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, readOwnerFile } from './fixtures.ts';

// I5: version strings + upstream archives are the only version-specific inputs.
const VERIFIED_VERSIONS = ['0.21.5', '0.25.12', '0.28.2'];
const PROJECT_FILES = {
  'src/index.ts': "import { answer } from './m.ts'; console.log(answer);\n",
  'src/m.ts': 'export const answer: number = 42;\n',
  'build.mjs': `import esbuild from 'esbuild';
await esbuild.build({entryPoints:['src/index.ts'],bundle:true,outfile:'dist/out.js'});
if(globalThis.__riftyShadowRegistry?.esbuild) throw new Error('generated esbuild runtime loaded');
`,
};

function filesUnder(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(prefix, entry.name);
      return entry.isDirectory() ? filesUnder(root, path) : [path];
    })
    .sort();
}
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

for (const version of VERIFIED_VERSIONS) {
  test(`upstream twin ${version}: install, stock entry, bundle and complete upstream bytes`, async ({
    page,
  }) => {
    test.fail(true, 'esbuild-upstream-twin acceptance carrier: cutover pending');
    test.setTimeout(240_000);
    const root = mkdtempSync(join(tmpdir(), 'rifty-upstream-twin-'));
    const archive = readFileSync(
      fileURLToPath(
        new URL(
          `../integration/fixtures/registry/esbuild-upstream/esbuild-wasm-${version}.tgz`,
          import.meta.url,
        ),
      ),
    );
    const packageRoot = join(root, 'node_modules/esbuild');
    mkdirSync(packageRoot, { recursive: true });
    const archivePath = join(root, 'upstream.tgz');
    writeFileSync(archivePath, archive);
    execFileSync('tar', ['-xzf', archivePath, '--strip-components=1', '-C', packageRoot]);
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    for (const [path, contents] of Object.entries(PROJECT_FILES)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), contents);
    }
    const oracle = execFileSync(process.execPath, ['build.mjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(oracle).toBe('');
    const expectedBundle = readFileSync(join(root, 'dist/out.js'), 'utf8');
    const expectedFiles = Object.fromEntries(
      filesUnder(packageRoot).map((path) => [path, sha256(readFileSync(join(packageRoot, path)))]),
    );
    let ownerOpen = false;
    try {
      await page.route('**/npm-registry/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('.tgz')) {
          await route.fulfill({ body: archive, contentType: 'application/octet-stream' });
        } else {
          const name = decodeURIComponent(path.split('/npm-registry/')[1] ?? '');
          expect(['esbuild', 'esbuild-wasm']).toContain(name);
          await route.fulfill({
            json: {
              name,
              'dist-tags': { latest: version },
              versions: {
                [version]: {
                  ...manifest,
                  name,
                  dist: {
                    tarball: new URL(`./esbuild-wasm-${version}.tgz`, route.request().url()).href,
                    integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
                  },
                },
              },
            },
          });
        }
      });
      await gotoHarness(page);
      await bootOwner(page, {
        workspaceId: `bu-upstream-twin-${version}`,
        persistence: 'ephemeral',
        plan: {
          kind: 'node-cli',
          id: 'scratch',
          starterId: 'upstream-twin',
          templateId: 'browser-unit:upstream-twin',
          files: {
            '/package.json': JSON.stringify({
              name: 'upstream-twin',
              private: true,
              type: 'module',
            }),
            ...Object.fromEntries(
              Object.entries(PROJECT_FILES).map(([path, text]) => [`/${path}`, text]),
            ),
            '/inspect.cjs': `const fs=require('fs'), path=require('path'), crypto=require('crypto');
const root='node_modules/esbuild-wasm';
function walk(dir){return fs.readdirSync(dir).flatMap(name=>{const p=path.join(dir,name);return fs.statSync(p).isDirectory()?walk(p):[p]})}
const files=Object.fromEntries(walk(root).sort().map(p=>[path.relative(root,p),crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
fs.writeFileSync('upstream-files.json',JSON.stringify(files));
if(globalThis.__riftyShadowRegistry?.esbuild) throw new Error('generated esbuild runtime loaded');
`,
          },
          firstMaterialization: { kind: 'install' },
          entryPath: '/build.mjs',
        },
      });
      ownerOpen = true;
      const range = version.startsWith('0.21.')
        ? '~0.21.5'
        : `^${version.split('.').slice(0, 2).join('.')}.0`;
      const install = await execLine(page, `npm install esbuild@${range}`);
      expect(install.exit, install.out).toBe(0);
      const build = await execLine(page, 'node build.mjs');
      expect(build.exit, build.out).toBe(0);
      const bundle = await readOwnerFile(page, '/scratch/dist/out.js');
      expect(bundle.ok, bundle.error).toBe(true);
      expect(bundle.text).toBe(expectedBundle);
      const inspect = await execLine(page, 'node inspect.cjs');
      expect(inspect.exit, inspect.out).toBe(0);
      const files = await readOwnerFile(page, '/scratch/upstream-files.json');
      expect(files.ok, files.error).toBe(true);
      expect(JSON.parse(files.text)).toEqual(expectedFiles);
    } finally {
      if (ownerOpen) await closeOwner(page);
      rmSync(root, { recursive: true, force: true });
    }
  });
}
