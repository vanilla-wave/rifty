import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, readOwnerFile } from './fixtures.ts';

// I5: version strings + upstream archives are the only version-specific inputs.
const VERIFIED_VERSIONS = ['0.21.5', '0.25.12', '0.28.2'];
const PROJECT_FILES = {
  'sync.cjs': readFileSync(
    new URL('./fixtures/esbuild-upstream-sync.cjs', import.meta.url),
    'utf8',
  ),
  'api.cjs': readFileSync(new URL('./fixtures/esbuild-upstream-api.cjs', import.meta.url), 'utf8'),
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

function nativeCli(root: string, packageName: string, mode: 'pipe' | 'tty' | 'file') {
  const executable = packageName === 'esbuild' ? 'npx' : process.execPath;
  const args =
    packageName === 'esbuild'
      ? ['--no-install', 'esbuild', 'src/index.ts', '--bundle']
      : [`node_modules/${packageName}/bin/esbuild`, 'src/index.ts', '--bundle'];
  if (mode === 'tty') {
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const scriptArgs =
      process.platform === 'linux'
        ? ['-q', '-e', '-c', [executable, ...args].map(quote).join(' '), '/dev/null']
        : ['-q', '/dev/null', executable, ...args];
    const result = spawnSync('script', scriptArgs, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 30000,
    });
    if (result.error) throw result.error;
    let output = result.stdout;
    if (output.startsWith('^D')) {
      output = output.slice(2);
      while (output.charCodeAt(0) === 8) output = output.slice(1);
    }
    return { exit: result.status, text: output.replaceAll('\r\n', '\n') };
  }
  const fd = mode === 'file' ? openSync(join(root, 'cli-output.js'), 'w') : undefined;
  try {
    const result = spawnSync(executable, args, {
      cwd: root,
      stdio: ['ignore', fd ?? 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 30000,
    });
    if (result.error) throw result.error;
    return {
      exit: result.status,
      text: fd === undefined ? result.stdout : readFileSync(join(root, 'cli-output.js'), 'utf8'),
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

for (const requestedName of ['esbuild', 'esbuild-wasm']) {
  for (const version of VERIFIED_VERSIONS) {
    test(`upstream twin ${requestedName}@${version}: install, stock entry, bundle and complete upstream bytes`, async ({
      page,
    }) => {
      test.fail(requestedName === 'esbuild', 'Workbench COI range selection remains RED');
      test.setTimeout(240_000);
      const root = mkdtempSync(join(tmpdir(), 'rifty-upstream-twin-'));
      let ownerOpen = false;
      try {
        const archive = readFileSync(
          fileURLToPath(
            new URL(
              `../integration/fixtures/registry/esbuild-upstream/esbuild-wasm-${version}.tgz`,
              import.meta.url,
            ),
          ),
        );
        const packageRoot = join(root, `node_modules/${requestedName}`);
        const projectFiles = {
          ...PROJECT_FILES,
          'build.mjs': PROJECT_FILES['build.mjs'].replace(
            "from 'esbuild'",
            `from '${requestedName}'`,
          ),
        };
        mkdirSync(packageRoot, { recursive: true });
        const archivePath = join(root, 'upstream.tgz');
        writeFileSync(archivePath, archive);
        execFileSync('tar', ['-xzf', archivePath, '--strip-components=1', '-C', packageRoot]);
        mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
        symlinkSync(`../${requestedName}/bin/esbuild`, join(root, 'node_modules/.bin/esbuild'));
        writeFileSync(
          join(root, 'package.json'),
          JSON.stringify({ name: 'upstream-oracle', private: true }),
        );
        const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
        for (const [path, contents] of Object.entries(projectFiles)) {
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
        execFileSync(process.execPath, ['api.cjs', requestedName], {
          cwd: root,
          encoding: 'utf8',
          timeout: 30_000,
        });
        const expectedApi = JSON.parse(readFileSync(join(root, 'api-result.json'), 'utf8'));
        const expectedCli = Object.fromEntries(
          (['pipe', 'tty', 'file'] as const).map((mode) => [
            mode,
            nativeCli(root, requestedName, mode),
          ]),
        );
        const expectedFiles = Object.fromEntries(
          filesUnder(packageRoot).map((path) => [
            path,
            sha256(readFileSync(join(packageRoot, path))),
          ]),
        );
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
          workspaceId: `bu-upstream-twin-${requestedName}-${version}`,
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
                Object.entries(projectFiles).map(([path, text]) => [`/${path}`, text]),
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
        const install = await execLine(page, `npm install ${requestedName}@${range}`);
        expect(install.exit, install.out).toBe(0);
        const build = await execLine(page, 'node build.mjs');
        expect(build.exit, build.out).toBe(0);
        const bundle = await readOwnerFile(page, '/scratch/dist/out.js');
        expect(bundle.ok, bundle.error).toBe(true);
        expect(bundle.text).toBe(expectedBundle);
        const api = await execLine(page, `node api.cjs ${requestedName}`);
        expect(api.exit, api.out).toBe(0);
        const apiResult = await readOwnerFile(page, '/scratch/api-result.json');
        expect(apiResult.ok, apiResult.error).toBe(true);
        expect(JSON.parse(apiResult.text)).toEqual(expectedApi);
        for (const route of ['workers', 'exec']) {
          const sync = await execLine(page, `node sync.cjs ${requestedName} ${route}`);
          expect(sync.exit, sync.out).toBe(0);
          const result = await readOwnerFile(page, '/scratch/sync-result.json');
          expect(result.ok, result.error).toBe(true);
          const methods = JSON.parse(result.text);
          expect(Object.keys(methods).sort()).toEqual([
            'analyzeMetafileSync',
            'buildSync',
            'formatMessagesSync',
            'transformSync',
          ]);
          for (const outcome of Object.values(methods)) {
            expect(outcome).toEqual({
              name: 'NotImplementedError',
              feature:
                route === 'workers'
                  ? 'worker_threads.workerData.structuredClone'
                  : 'child_process.execFileSync',
            });
          }
        }
        for (const mode of ['pipe', 'tty', 'file'] as const) {
          const executable =
            requestedName === 'esbuild'
              ? 'npx esbuild'
              : `node node_modules/${requestedName}/bin/esbuild`;
          const command = `${executable} src/index.ts --bundle${mode === 'file' ? ' > cli-output.js' : mode === 'pipe' ? ' | cat > cli-output.js' : ''}`;
          const cli = await execLine(page, command);
          expect(cli.exit, cli.out).toBe(expectedCli[mode].exit);
          if (mode === 'tty') {
            expect(cli.out.replaceAll('\r\n', '\n')).toBe(expectedCli[mode].text);
          } else {
            const output = await readOwnerFile(page, '/scratch/cli-output.js');
            expect(output.ok, output.error).toBe(true);
            expect(output.text, `${mode}: ${cli.out}`).toBe(expectedCli[mode].text);
          }
        }

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
}
