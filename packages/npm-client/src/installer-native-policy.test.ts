import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import { type Packument, RegistryClient, type VersionManifest } from './registry.ts';

/**
 * Native-dependency install policy (ADR-0051). rifty can't run native compiled
 * binaries; the installer must fail loudly (`ENATIVEUNSUPPORTED`) on a required
 * native, skip-with-warning an optional native, and never reject a shadow-
 * substituted or pure-JS package.
 */
interface Entry {
  manifest: VersionManifest;
  tarball: Uint8Array;
}

class FakeRegistry extends RegistryClient {
  constructor(private readonly db: Map<string, Map<string, Entry>>) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
  }
  override async getPackument(name: string): Promise<Packument> {
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fake registry: no packument for ${name}`);
    const versionsMap: Record<string, VersionManifest> = {};
    for (const [v, e] of versions) versionsMap[v] = e.manifest;
    const sorted = [...versions.keys()].sort();
    return {
      name,
      'dist-tags': { latest: sorted[sorted.length - 1] ?? '0.0.0' },
      versions: versionsMap,
    };
  }
  override async getTarball(url: string): Promise<Uint8Array> {
    const m = /^fake:\/\/([^/]+)\/(.+)$/.exec(url);
    if (!m) throw new Error(`bad url ${url}`);
    const e = this.db.get(m[1] ?? '')?.get(m[2] ?? '');
    if (!e) throw new Error(`no tarball ${url}`);
    return e.tarball;
  }
}

async function entry(
  name: string,
  version: string,
  extra: Partial<VersionManifest> = {},
): Promise<Entry> {
  return {
    manifest: {
      name,
      version,
      dependencies: {},
      dist: { tarball: `fake://${name}/${version}` },
      ...extra,
    },
    tarball: await makePackageTarball(name, version),
  };
}

function db(entries: Entry[]): Map<string, Map<string, Entry>> {
  const d = new Map<string, Map<string, Entry>>();
  for (const e of entries) {
    if (!d.has(e.manifest.name)) d.set(e.manifest.name, new Map());
    d.get(e.manifest.name)?.set(e.manifest.version, e);
  }
  return d;
}

describe('install — native-dependency policy (ADR-0051)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('throws ENATIVEUNSUPPORTED for a native top-level request', async () => {
    const registry = new FakeRegistry(
      db([await entry('opencode-ai', '1.0.0', { os: ['darwin', 'linux'], cpu: ['arm64', 'x64'] })]),
    );
    const err = await install(
      'root',
      '1.0.0',
      { 'opencode-ai': '1.0.0' },
      { vfs: new MemoryVfs(), cwd: '/app', registry },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe('ENATIVEUNSUPPORTED');
    expect((err as { packageName?: string }).packageName).toBe('opencode-ai');
    expect((err as { platform?: { cpu?: string[] } }).platform?.cpu).toEqual(['arm64', 'x64']);
    expect((err as Error).message).toContain('docs/public/compat/incompatible-packages.md');
  });

  it('aborts on a REQUIRED transitive native dep', async () => {
    const registry = new FakeRegistry(
      db([
        await entry('app', '1.0.0', { dependencies: { 'native-req': '1.0.0' } }),
        await entry('native-req', '1.0.0', { cpu: ['arm64'] }),
      ]),
    );
    const err = await install(
      'root',
      '1.0.0',
      { app: '1.0.0' },
      { vfs: new MemoryVfs(), cwd: '/app', registry },
    ).catch((e) => e);
    expect((err as { code?: string }).code).toBe('ENATIVEUNSUPPORTED');
    expect((err as { packageName?: string }).packageName).toBe('native-req');
  });

  it('skips an OPTIONAL transitive native dep with a warning (install succeeds)', async () => {
    const registry = new FakeRegistry(
      db([
        await entry('app', '1.0.0', { optionalDependencies: { 'native-opt': '1.0.0' } }),
        await entry('native-opt', '1.0.0', { cpu: ['arm64'] }),
      ]),
    );
    const result = await install(
      'root',
      '1.0.0',
      { app: '1.0.0' },
      { vfs: new MemoryVfs(), cwd: '/app', registry },
    );
    const names = result.packages.map((p) => p.name);
    expect(names).toContain('app');
    expect(names).not.toContain('native-opt');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('native-opt'));
  });

  it('does NOT reject a pure-JS package that pins only `os` (no `cpu`)', async () => {
    const registry = new FakeRegistry(db([await entry('os-only', '1.0.0', { os: ['darwin'] })]));
    const result = await install(
      'root',
      '1.0.0',
      { 'os-only': '1.0.0' },
      { vfs: new MemoryVfs(), cwd: '/app', registry },
    );
    expect(result.packages.map((p) => p.name)).toContain('os-only');
  });

  it('does NOT reject a `cpu: ["wasm"]` package', async () => {
    const registry = new FakeRegistry(db([await entry('wasm-pkg', '1.0.0', { cpu: ['wasm'] })]));
    const result = await install(
      'root',
      '1.0.0',
      { 'wasm-pkg': '1.0.0' },
      { vfs: new MemoryVfs(), cwd: '/app', registry },
    );
    expect(result.packages.map((p) => p.name)).toContain('wasm-pkg');
  });

  it('a baked override (bcrypt → bcryptjs) pre-empts the native check', async () => {
    // `bcrypt` is in bakedOverrides → bcryptjs; the native bcrypt is never even
    // fetched (the override redirects before the manifest read). bcryptjs is
    // pure-JS (no cpu) and installs cleanly.
    // The baked `bcrypt → bcryptjs` override carries no range, so the request
    // range is reused — use `*` so it matches the vendored bcryptjs version.
    const registry = new FakeRegistry(db([await entry('bcryptjs', '2.4.3')]));
    const result = await install(
      'root',
      '1.0.0',
      { bcrypt: '*' },
      { vfs: new MemoryVfs(), cwd: '/app', registry },
    );
    const names = result.packages.map((p) => p.name);
    expect(names).toContain('bcryptjs');
    expect(names).not.toContain('bcrypt');
  });
});
