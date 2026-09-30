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
  { args: ['ms', '--save-exact'], initial: {} },
  { args: ['ms', '--save-dev'], initial: {} },
  { args: ['ms', '-D'], initial: { dependencies: { ms: '2.0.0' } } },
  { args: ['ms'], initial: { devDependencies: { ms: '2.0.0' } } },
  { args: ['ms'], initial: { dependencies: { ms: '~2.0.0' } } },
  { args: [], initial: { dependencies: { ms: '2.0.0' } } },
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
  let origin = '';
  const requests: string[] = [];
  let beforeResponse: ((path: string) => Promise<void>) | undefined;
  const server = createServer(async (request, response) => {
    const path = request.url ?? '/';
    requests.push(path);
    response.setHeader('access-control-allow-origin', '*');
    try {
      await beforeResponse?.(path);
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
          installedVersion: installed.version,
        };
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}
