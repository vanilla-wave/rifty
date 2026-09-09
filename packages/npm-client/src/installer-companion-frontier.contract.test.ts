import { createHash } from 'node:crypto';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inputFixture,
  registryFixture,
  registryUrl,
} from '../../../tests/integration/fixtures/registry/rollup-companions/fixture.mjs';
import { install } from './installer.ts';
import type { Lockfile } from './linker.ts';
import { RegistryClient } from './registry.ts';

type InputName = Parameters<typeof inputFixture>[0];
const companion = 'node_modules/@rollup/wasm-node';

async function prepare(name: InputName, mutate?: (lock: Lockfile) => void) {
  const input = await inputFixture(name === 'retained' ? 'root' : name);
  let lock = JSON.parse(input.packageLockText) as Lockfile;
  const http = await registryFixture();
  const registry = new RegistryClient({
    baseUrl: registryUrl,
    maxRetries: 0,
    fetch: http.fetch,
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  if (name === 'retained') {
    const seed = createMemoryFs();
    await seed.vfs.mkdir('/project', { recursive: true });
    await seed.vfs.writeFile('/project/package.json', input.packageJsonText);
    lock = (await install({ vfs: seed.vfs, cwd: '/project', registry })).lockfile;
    http.requests.length = 0;
  }
  mutate?.(lock);
  const { vfs } = createMemoryFs();
  await vfs.mkdir('/project', { recursive: true });
  await vfs.writeFile('/project/package.json', input.packageJsonText);
  await vfs.writeFile('/project/package-lock.json', JSON.stringify(lock));
  return { input, lock, vfs, http, registry };
}

function identity(lock: Lockfile, path: string) {
  const entry = lock.packages[path];
  if (!entry) throw new Error(`Expected installed pin ${path}`);
  return { version: entry.version, resolved: entry.resolved, integrity: entry.integrity };
}

function metadataRequests(http: Awaited<ReturnType<typeof registryFixture>>) {
  return http.requests
    .filter(({ url }) => !url.endsWith('.tgz'))
    .map(({ url }) => decodeURIComponent(new URL(url).pathname));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('declared companion source frontier from real npm locks', () => {
  it('[fault: sibling-drift] acquires the declared companion of a retained trigger and replays offline', async () => {
    const { vfs, registry, lock, http } = await prepare('root');
    const installed = await install({ vfs, cwd: '/project', registry });
    expect(installed.provenance.resolution).toBe('metadata');
    expect(installed.lockfile.packages[companion]?.version).toBe('4.63.1');
    expect(identity(installed.lockfile, 'node_modules/rollup')).toEqual(
      identity(lock, 'node_modules/rollup'),
    );
    expect(identity(installed.lockfile, 'node_modules/@types/estree')).toEqual(
      identity(lock, 'node_modules/@types/estree'),
    );
    expect(metadataRequests(http)).toEqual(['/@rollup/wasm-node']);
    expect(
      await vfs.readFile(
        '/project/node_modules/@rollup/wasm-node/dist/wasm-node/bindings_wasm_bg.wasm',
      ),
    ).toBeInstanceOf(Uint8Array);

    const replay = await install({
      vfs,
      cwd: '/project',
      registry: new RegistryClient({
        baseUrl: registryUrl,
        maxRetries: 0,
        fetch: async () => {
          throw new Error('offline companion replay attempted HTTP');
        },
      }),
    });
    expect(replay.provenance.resolution).toBe('lockfile');
    expect(replay.lockfile).toEqual(installed.lockfile);
  });

  it('[fault: sibling-drift] keeps both retained root/nested Rollup pins and installs both lockstep companions', async () => {
    const { vfs, registry, lock } = await prepare('nested');
    const result = await install({ vfs, cwd: '/project', registry });
    for (const path of ['node_modules/rollup', 'node_modules/vite/node_modules/rollup']) {
      expect(identity(result.lockfile, path)).toEqual(identity(lock, path));
    }
    expect(
      result.packages
        .filter(({ name }) => name === '@rollup/wasm-node')
        .map(({ version }) => version)
        .sort(),
    ).toEqual(['4.42.0', '4.63.1']);
    expect(result.lockfile.packages[companion]?.version).toBe('4.63.1');
    expect(result.lockfile.packages[`node_modules/rollup/${companion}`]?.version).toBe('4.42.0');
  }, 90_000);

  it('retains an existing companion source identity without metadata refresh', async () => {
    const http = await registryFixture();
    const sri = `sha256-${createHash('sha256').update(http.tarball('@rollup/wasm-node', '4.63.1')).digest('base64')}`;
    const state = await prepare('retained', (lock) => {
      lock.packages[companion]!.integrity = sri;
    });
    const result = await install({ vfs: state.vfs, cwd: '/project', registry: state.registry });
    expect(identity(result.lockfile, companion)).toEqual(identity(state.lock, companion));
    expect(metadataRequests(state.http)).toEqual([]);
  });

  it('does not synthesize a missing companion pin from cached bytes without a registry', async () => {
    const { vfs, registry } = await prepare('retained');
    const installed = await install({ vfs, cwd: '/project', registry });
    Reflect.deleteProperty(installed.lockfile.packages, companion);
    await vfs.writeFile('/project/package-lock.json', JSON.stringify(installed.lockfile));
    await expect(install({ vfs, cwd: '/project' })).rejects.toThrow(
      /registry unavailable for @rollup\/wasm-node/,
    );
  });

  it('[fault: corrupt-input] keeps a missing ordinary child of a retained trigger loud', async () => {
    const { vfs, registry } = await prepare('root', (lock) => {
      Reflect.deleteProperty(lock.packages, 'node_modules/@types/estree');
    });
    await expect(install({ vfs, cwd: '/project', registry })).rejects.toMatchObject({
      code: 'EBROKENLOCK',
      reason: 'missing-entry',
      packageName: '@types/estree',
    });
  });

  it('[fault: corrupt-input] refuses corrupt acquired companion bytes before publishing a lock', async () => {
    const { vfs, lock, http } = await prepare('root');
    const registry = new RegistryClient({
      baseUrl: registryUrl,
      maxRetries: 0,
      fetch: async (url, init) => {
        const response = await http.fetch(url, init);
        if (!url.endsWith('/wasm-node-4.63.1.tgz')) return response;
        const bytes = new Uint8Array(await response.arrayBuffer());
        bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
        return new Response(bytes.buffer);
      },
    });
    await expect(install({ vfs, cwd: '/project', registry })).rejects.toThrow(/integrity/i);
    expect(JSON.parse(await vfs.readFileText('/project/package-lock.json'))).toEqual(lock);
  });

  it('[fault: sibling-drift] lets Eddy attempt the same policy frontier, then verifies registry fallback', async () => {
    const { vfs, registry } = await prepare('root');
    const eddyCalls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      eddyCalls.push(`${init?.method ?? 'GET'} ${url}`);
      throw new Error('fixture Eddy unavailable');
    });
    const outcome = await install({
      vfs,
      cwd: '/project',
      registry,
      resolverUrl: 'https://companion-eddy.test/resolve',
    }).then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    expect(eddyCalls).toEqual(['POST https://companion-eddy.test/resolve']);
    expect(outcome).not.toHaveProperty('error');
    if (!('result' in outcome)) throw new Error('Expected verified registry fallback');
    expect(outcome.result.provenance.eddyFallback?.reason).toContain('fixture Eddy unavailable');
    expect(outcome.result.lockfile.packages[companion]?.version).toBe('4.63.1');
  });

  it('[fault: corrupt-input] does not ask Eddy to repair a missing ordinary retained edge', async () => {
    const { vfs, registry } = await prepare('root', (lock) => {
      Reflect.deleteProperty(lock.packages, 'node_modules/@types/estree');
    });
    const eddy = vi.fn(async () => {
      throw new Error('ordinary lock hole reached Eddy');
    });
    vi.stubGlobal('fetch', eddy);
    await expect(
      install({
        vfs,
        cwd: '/project',
        registry,
        resolverUrl: 'https://companion-eddy.test/resolve',
      }),
    ).rejects.toMatchObject({ code: 'EBROKENLOCK', packageName: '@types/estree' });
    expect(eddy).not.toHaveBeenCalled();
  });
});
