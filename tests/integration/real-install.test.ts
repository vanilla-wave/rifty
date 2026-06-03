/**
 * Real-install integration tests (ADR-0021).
 *
 * Drives `@riftydev/npm-client.install()` end-to-end against three real npm
 * tarballs vendored under `tests/integration/fixtures/registry/`:
 *
 *  - `picocolors@1.0.0` (no deps)
 *  - `ms@2.1.3`         (no deps)
 *  - `kleur@4.1.5`      (no deps)
 *
 * No network at runtime; every fetch is routed through `local-registry.ts`.
 */
import { RegistryClient, install } from '@riftydev/npm-client';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { LOCAL_REGISTRY_BASE_URL, makeLocalFetcher } from './fixtures/local-registry.ts';

function makeRegistry() {
  const { fetch, calls } = makeLocalFetcher();
  const registry = new RegistryClient({ baseUrl: LOCAL_REGISTRY_BASE_URL, fetch });
  return { registry, calls };
}

describe('integration — real npm tarballs through install()', () => {
  it('installs picocolors@1.0.0 and produces a parseable package.json + index.js', async () => {
    const vfs = new MemoryVfs();
    const { registry } = makeRegistry();
    const result = await install(
      'root',
      '0.0.0',
      { picocolors: '^1.0.0' },
      { vfs, cwd: '/app', registry },
    );

    expect(result.packages.length).toBe(1);
    expect(result.packages[0]?.name).toBe('picocolors');
    expect(result.packages[0]?.version).toBe('1.0.0');

    const pkgJsonText = await vfs.readFileText('/app/node_modules/picocolors/package.json');
    const pkgJson = JSON.parse(pkgJsonText) as { name: string; version: string; main: string };
    expect(pkgJson.name).toBe('picocolors');
    expect(pkgJson.version).toBe('1.0.0');
    // The real package ships `./picocolors.js` as its main entry — assert the
    // file landed in place.
    expect(await vfs.exists('/app/node_modules/picocolors/picocolors.js')).toBe(true);
    const main = await vfs.readFileText('/app/node_modules/picocolors/picocolors.js');
    expect(main.length).toBeGreaterThan(0);
  });

  it('installs picocolors + ms + kleur in one go and lays them out flat', async () => {
    const vfs = new MemoryVfs();
    const { registry } = makeRegistry();
    const result = await install(
      'root',
      '0.0.0',
      { picocolors: '^1.0.0', ms: '^2.1.3', kleur: '^4.1.5' },
      { vfs, cwd: '/app', registry },
    );

    const names = result.packages.map((p) => p.name).sort();
    expect(names).toEqual(['kleur', 'ms', 'picocolors']);

    for (const name of names) {
      expect(await vfs.exists(`/app/node_modules/${name}/package.json`)).toBe(true);
    }

    const lockText = await vfs.readFileText('/app/package-lock.json');
    const lock = JSON.parse(lockText) as {
      lockfileVersion: number;
      packages: Record<string, { version: string; integrity?: string }>;
    };
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages['node_modules/picocolors']?.version).toBe('1.0.0');
    expect(lock.packages['node_modules/ms']?.version).toBe('2.1.3');
    expect(lock.packages['node_modules/kleur']?.version).toBe('4.1.5');
    // Integrity was either taken from the manifest or computed from the
    // tarball bytes; either way it must be present so the cache can key on it.
    expect(lock.packages['node_modules/picocolors']?.integrity).toBeTruthy();
  });

  it('second install reuses the lockfile + tarball cache (zero tarball fetches)', async () => {
    const vfs = new MemoryVfs();

    const first = makeRegistry();
    await install(
      'root',
      '0.0.0',
      { picocolors: '^1.0.0', ms: '^2.1.3' },
      { vfs, cwd: '/app', registry: first.registry },
    );
    expect(first.calls.tarball).toBe(2);
    expect(first.calls.packument).toBe(2);

    // Fresh fetcher so `calls` starts at zero; the lockfile + tarball cache
    // sit in `vfs` and must satisfy the second install on their own.
    const second = makeRegistry();
    await install(
      'root',
      '0.0.0',
      { picocolors: '^1.0.0', ms: '^2.1.3' },
      { vfs, cwd: '/app', registry: second.registry },
    );
    expect(second.calls.tarball).toBe(0);
    expect(second.calls.packument).toBe(0);
  });
});
