import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const fixtureRoot = new URL('../../integration/fixtures/registry/', import.meta.url);
export const initialManifest = { name: 'install-oracle', version: '1.0.0', private: true };
export const saveCases = [
  { args: ['ms'], initial: {} },
  { args: ['ms@2.1.3'], initial: {} },
  { args: ['ms@^2.0.0'], initial: {} },
  { args: ['ms@~2.0.0'], initial: {} },
  { args: ['ms@~2'], initial: {} },
  { args: ['ms@~2.0'], initial: {} },
  { args: ['ms@~2.0.0 || ~2.1.0'], initial: {} },
  { args: ['ms@>=2.0.0 <2.1.0'], initial: {} },
  { args: ['ms@2.x'], initial: {} },
  { args: ['ms@2.1.x'], initial: {} },
  { args: ['ms', '--save-exact'], initial: {} },
  { args: ['ms', '--save-dev'], initial: {} },
  { args: ['ms', '-D'], initial: { dependencies: { ms: '2.0.0' } } },
  { args: ['ms'], initial: { devDependencies: { ms: '2.0.0' } } },
  { args: ['ms'], initial: { dependencies: { ms: '~2.0.0' } } },
  { args: [], initial: { dependencies: { ms: '2.0.0' } } },
  { args: [], initial: { dependencies: { ms: '2.1.3' }, devDependencies: { ms: '2.0.0' } } },
  {
    args: [],
    initial: { devDependencies: { ms: '2.1.3' }, optionalDependencies: { ms: '2.0.0' } },
  },
  { args: [], initial: { dependencies: { ms: '2.1.3' }, optionalDependencies: { ms: '2.0.0' } } },
  { args: ['ms'], initial: { dependencies: { ms: '2.1.3' }, devDependencies: { ms: '2.0.0' } } },
  {
    args: ['ms', '-S'],
    initial: { dependencies: { ms: '2.1.3' }, devDependencies: { ms: '2.0.0' } },
  },
  {
    args: ['ms', '-E'],
    initial: { dependencies: { ms: '2.1.3' }, devDependencies: { ms: '2.0.0' } },
  },
  { args: ['ms', '-D'], initial: { optionalDependencies: { ms: '2.0.0' } } },
  {
    args: ['ms'],
    initial: { devDependencies: { ms: '2.1.3' }, optionalDependencies: { ms: '2.0.0' } },
  },
  {
    args: ['ms'],
    initial: { devDependencies: { ms: '2.0.0' }, optionalDependencies: { ms: '2.1.3' } },
  },
  {
    args: ['ms', '-E'],
    initial: { devDependencies: { ms: '2.0.0' }, optionalDependencies: { ms: '2.1.3' } },
  },
  {
    args: ['ms', '-D'],
    initial: { devDependencies: { ms: '2.1.3' }, optionalDependencies: { ms: '2.0.0' } },
  },
  {
    args: ['ms'],
    initial: { dependencies: { ms: '2.1.3' }, optionalDependencies: { ms: '2.0.0' } },
  },
  {
    args: ['kleur'],
    initial: { dependencies: { ms: '2.1.3' }, optionalDependencies: { ms: '2.0.0' } },
  },
  { args: ['ms@*'], initial: { dependencies: { ms: '2.0.0' } } },
] as const;

/** HTTP only is controlled; npm and rifty consume identical upstream archives. */
export async function installRegistry() {
  const versions: Record<
    string,
    { bytes: Buffer; manifest: Record<string, unknown>; integrity: string }
  > = {};
  for (const version of ['2.0.0', '2.1.3']) {
    const path = fileURLToPath(new URL(`ms-${version}.tgz`, fixtureRoot));
    const bytes = await readFile(path);
    versions[version] = {
      bytes,
      manifest: JSON.parse(
        execFileSync('tar', ['-xOf', path, 'package/package.json'], { encoding: 'utf8' }),
      ),
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    };
  }
  const kleurPath = fileURLToPath(new URL('kleur-4.1.5.tgz', fixtureRoot));
  const kleur = await readFile(kleurPath);
  const kleurManifest = JSON.parse(
    execFileSync('tar', ['-xOf', kleurPath, 'package/package.json'], { encoding: 'utf8' }),
  );
  let origin = '';
  const requests: string[] = [];
  let beforeResponse: ((path: string) => Promise<void>) | undefined;
  const server = createServer(async (request, response) => {
    const path = request.url ?? '/';
    requests.push(path);
    response.setHeader('access-control-allow-origin', '*');
    try {
      await beforeResponse?.(path);
      if (path === '/kleur') {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            name: 'kleur',
            'dist-tags': { latest: '4.1.5' },
            versions: {
              '4.1.5': {
                ...kleurManifest,
                dist: {
                  tarball: `${origin}/kleur/-/kleur-4.1.5.tgz`,
                  integrity: `sha512-${createHash('sha512').update(kleur).digest('base64')}`,
                },
              },
            },
          }),
        );
        return;
      }
      if (path === '/kleur/-/kleur-4.1.5.tgz') {
        response.end(kleur);
        return;
      }
      if (path === '/ms') {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            name: 'ms',
            'dist-tags': { latest: '2.1.3' },
            versions: Object.fromEntries(
              Object.entries(versions).map(([version, entry]) => [
                version,
                {
                  ...entry.manifest,
                  dist: { tarball: `${origin}/ms/-/ms-${version}.tgz`, integrity: entry.integrity },
                },
              ]),
            ),
          }),
        );
        return;
      }
      const version = /^\/ms\/-\/ms-(.+)\.tgz$/.exec(path)?.[1];
      if (version && versions[version]) {
        response.end(versions[version].bytes);
        return;
      }
      response.writeHead(404);
      response.end('missing fixture package');
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing registry address');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    requests,
    hold(callback?: (path: string) => Promise<void>) {
      beforeResponse = callback;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
    async native(args: readonly string[], initial: object = {}) {
      const cwd = await mkdtemp(join(tmpdir(), 'rifty-kit-npm-'));
      try {
        await writeFile(
          join(cwd, 'package.json'),
          JSON.stringify({ ...initialManifest, ...initial }),
        );
        await exec(
          'npm',
          [
            'install',
            ...args,
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--prefer-online',
            '--registry',
            origin,
            '--cache',
            join(cwd, 'cache'),
          ],
          { cwd },
        );
        const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
        const lock = JSON.parse(await readFile(join(cwd, 'package-lock.json'), 'utf8'));
        const installed = JSON.parse(
          await readFile(join(cwd, 'node_modules/ms/package.json'), 'utf8'),
        );
        return {
          pkg,
          lockDependencies: lock.packages[''].dependencies,
          lockDevDependencies: lock.packages[''].devDependencies,
          lockOptionalDependencies: lock.packages[''].optionalDependencies,
          installedVersion: installed.version,
        };
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}
