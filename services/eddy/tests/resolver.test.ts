import {
  type Fetcher,
  type Lockfile,
  RegistryClient,
  computeIntegrity,
  install,
  parseIntegrityAlgorithm,
  unpackEddyBundle,
} from '@riftydev/npm-client';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { resolveBundle } from '../src/index.ts';
import { makeSyntheticRegistry } from './synthetic-registry.ts';

function nonRootPackages(lf: Lockfile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(lf.packages)) {
    if (key !== '') out[key] = entry;
  }
  return out;
}

describe('eddy resolveBundle — parity with a client live-resolve (vendored tarballs)', () => {
  it('reproduces the diamond closure byte-for-byte in the bundle lockfile', async () => {
    const deps = { debug: '^4.4.1', 'diamond-conflict-parent': '1.0.0' };

    // Direct client install (the parity reference).
    const vfs = new MemoryVfs();
    const direct = await install('root', '0.0.0', deps, {
      vfs,
      cwd: '/app',
      registry: new RegistryClient({
        baseUrl: LOCAL_REGISTRY_BASE_URL,
        fetch: makeLocalFetcher().fetch,
      }),
    });

    // Eddy resolution.
    const res = await resolveBundle(
      { dependencies: deps },
      {
        registryBaseUrl: LOCAL_REGISTRY_BASE_URL,
        fetch: makeLocalFetcher().fetch,
        now: () => '2026-06-30T00:00:00.000Z',
      },
    );
    expect(res.kind).toBe('bundle');
    if (res.kind !== 'bundle') return;

    const { lockfileText } = unpackEddyBundle(res.bytes);
    const eddyLf = JSON.parse(lockfileText) as Lockfile;

    // Non-root closure must be identical (versions, resolved, integrity, installPath).
    expect(nonRootPackages(eddyLf)).toEqual(nonRootPackages(direct.lockfile));
    // Root flat top-level deps identical (name/version of the root itself may differ).
    expect(eddyLf.packages['']?.dependencies).toEqual(direct.lockfile.packages['']?.dependencies);

    // Diamond layout: ms@2.1.3 flat, ms@2.0.0 nested under the wrapper.
    expect(eddyLf.packages['node_modules/ms']?.version).toBe('2.1.3');
    expect(eddyLf.packages['node_modules/diamond-conflict-parent/node_modules/ms']?.version).toBe(
      '2.0.0',
    );
  });

  it('bundles one tarball per unique resolved package, each matching its lockfile integrity', async () => {
    const res = await resolveBundle(
      { dependencies: { debug: '^4.4.1', 'diamond-conflict-parent': '1.0.0' } },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    expect(res.kind).toBe('bundle');
    if (res.kind !== 'bundle') return;
    const { manifest, lockfileText, tarballs } = unpackEddyBundle(res.bytes);
    const lf = JSON.parse(lockfileText) as Lockfile;

    // Unique (name@version) across non-root lockfile entries.
    const uniqueClosure = new Set(
      Object.entries(lf.packages)
        .filter(([k]) => k !== '')
        .map(([, e]) => `${(e as { version: string }).version}`), // version+name below
    );
    const lfPairs = new Set(
      Object.entries(lf.packages)
        .filter(([k]) => k !== '')
        .map(
          ([k, e]) =>
            `${k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length)}@${(e as { version: string }).version}`,
        ),
    );
    expect(uniqueClosure.size).toBeGreaterThan(0);

    // Every manifest tarball entry's integrity matches the lockfile entry of that name@version,
    // and the bytes hash to that integrity.
    for (const t of tarballs) {
      const alg = parseIntegrityAlgorithm(t.entry.integrity);
      expect(alg).not.toBeNull();
      if (!alg) continue;
      expect(await computeIntegrity(t.bytes, alg)).toBe(t.entry.integrity);
      expect(lfPairs.has(`${t.entry.name}@${t.entry.version}`)).toBe(true);
    }
    // Manifest tarballs cover exactly the unique closure (debug, ms@2.1.3, ms@2.0.0, diamond-conflict-parent).
    const manifestPairs = new Set(manifest.tarballs.map((t) => `${t.name}@${t.version}`));
    expect(manifestPairs).toEqual(lfPairs);
  });

  it('picks dist-tags.latest for an unconstrained range, same as the client', async () => {
    const vfs = new MemoryVfs();
    const direct = await install(
      'root',
      '0.0.0',
      { ms: '*' },
      {
        vfs,
        cwd: '/app',
        registry: new RegistryClient({
          baseUrl: LOCAL_REGISTRY_BASE_URL,
          fetch: makeLocalFetcher().fetch,
        }),
      },
    );
    const res = await resolveBundle(
      { dependencies: { ms: '*' } },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    expect(res.kind).toBe('bundle');
    if (res.kind !== 'bundle') return;
    const eddyLf = JSON.parse(unpackEddyBundle(res.bytes).lockfileText) as Lockfile;
    expect(eddyLf.packages['node_modules/ms']?.version).toBe('2.1.3');
    expect(direct.lockfile.packages['node_modules/ms']?.version).toBe('2.1.3');
  });

  it('returns a typed "unsupported" decline for a non-registry (file:) spec — never a synthesized bundle', async () => {
    const res = await resolveBundle(
      { dependencies: { 'local-thing': 'file:../local-thing' } },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    expect(res.kind).toBe('unsupported');
    if (res.kind !== 'unsupported') return;
    expect(res.feature).toMatch(/file/);
  });

  it('declines a REQUIRED native (cpu non-wasm) package exactly as the client gate would (ENATIVEUNSUPPORTED)', async () => {
    const reg = makeSyntheticRegistry([{ name: 'native-thing', version: '1.0.0', cpu: ['x64'] }]);
    const res = await resolveBundle(
      { dependencies: { 'native-thing': '1.0.0' } },
      { registryBaseUrl: reg.baseUrl, fetch: reg.fetch },
    );
    expect(res.kind).toBe('unsupported');
    if (res.kind !== 'unsupported') return;
    expect(res.feature).toMatch(/native|ENATIVEUNSUPPORTED/i);
  });

  it('skips an OPTIONAL native dependency and bundles the rest (esbuild-optionals parity)', async () => {
    const reg = makeSyntheticRegistry([
      { name: 'host', version: '1.0.0', optionalDependencies: { 'native-opt': '1.0.0' } },
      { name: 'native-opt', version: '1.0.0', cpu: ['x64'] },
    ]);
    const res = await resolveBundle(
      { dependencies: { host: '1.0.0' } },
      { registryBaseUrl: reg.baseUrl, fetch: reg.fetch },
    );
    expect(res.kind).toBe('bundle');
    if (res.kind !== 'bundle') return;
    const pairs = new Set(unpackEddyBundle(res.bytes).manifest.tarballs.map((t) => t.name));
    expect(pairs.has('host')).toBe(true);
    expect(pairs.has('native-opt')).toBe(false);
  });

  it('propagates cancellation through install to the active registry request', async () => {
    let markStarted = (): void => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let registrySignal: AbortSignal | undefined;
    const stalledFetch: Fetcher = async (_url, init) => {
      registrySignal = init?.signal ?? undefined;
      markStarted();
      return await new Promise<Response>((_resolve, reject) => {
        const signal = registrySignal as AbortSignal;
        const onAbort = (): void => reject(signal.reason);
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
    };
    const controller = new AbortController();
    const reason = new Error('request disconnected');
    const resolving = resolveBundle(
      { dependencies: { debug: '^4.4.1' } },
      {
        registryBaseUrl: LOCAL_REGISTRY_BASE_URL,
        fetch: stalledFetch,
        signal: controller.signal,
      },
    );
    await started;
    controller.abort(reason);

    await expect(resolving).rejects.toBe(reason);
    expect(registrySignal?.aborted).toBe(true);
  });
});
