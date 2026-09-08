import { readFile } from 'node:fs/promises';
import {
  type InstallOptions,
  type InstallResult,
  type Packument,
  RegistryClient,
  type VersionManifest,
  canonicalEddyRequestKey,
  compare,
  install,
  startEddyPrefetch,
  tarballCachePath,
} from '@riftydev/npm-client';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = '/project';
const DEPS = { ms: '2.0.0' };
const OVERLOADS = ['options', 'name-version-options', 'explicit-dependencies'] as const;
type Overload = (typeof OVERLOADS)[number];
type LocalOptions = Omit<InstallOptions, 'registry'>;
const unexpectedNetwork: string[] = [];

beforeEach(() => {
  unexpectedNetwork.length = 0;
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    unexpectedNetwork.push(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    throw new Error('unexpected network during registry-free install');
  });
});
afterEach(() => {
  try {
    expect(unexpectedNetwork).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

// Preparation bridge only: the real object has NO registry. Remove this cast
// when InstallOptions.registry becomes optional; no client or installer is replaced.
function invoke(
  kind: Overload,
  options: LocalOptions,
  dependencies: Record<string, string> = DEPS,
): Promise<InstallResult> {
  const input = options as InstallOptions;
  if (kind === 'options') return install(input);
  if (kind === 'name-version-options') return install('offline-root', '1.0.0', input);
  return install('offline-root', '1.0.0', dependencies, input);
}

async function project(dependencies: Record<string, string> = DEPS) {
  const vfs = new MemoryVfs();
  await vfs.mkdir(ROOT, { recursive: true });
  await vfs.writeFile(
    `${ROOT}/package.json`,
    JSON.stringify({ name: 'offline-root', version: '1.0.0', dependencies }),
  );
  return vfs;
}

async function tree(vfs: Vfs, root: string): Promise<Record<string, number[] | null>> {
  const result: Record<string, number[] | null> = {};
  const visit = async (path: string): Promise<void> => {
    for (const entry of await vfs.readdir(path)) {
      const child = `${path}/${entry.name}`;
      const key = child.slice(root.length);
      if (entry.isDirectory) {
        result[key] = null;
        await visit(child);
      } else result[key] = Array.from(await vfs.readFile(child));
    }
  };
  await visit(root);
  return result;
}

async function seeded() {
  const vfs = await project();
  const fixtureRoot = new URL('../../../tests/integration/fixtures/registry/', import.meta.url);
  const manifests = await Promise.all(
    ['ms.json', 'ms-2.0.0.json'].map(
      async (file) =>
        JSON.parse(await readFile(new URL(file, fixtureRoot), 'utf8')) as VersionManifest,
    ),
  );
  const packument = {
    name: 'ms',
    'dist-tags': {
      latest: manifests
        .map(({ version }) => version)
        .sort(compare)
        .at(-1),
    },
    versions: Object.fromEntries(manifests.map((manifest) => [manifest.version, manifest])),
  };
  const tarballs = new Map(
    await Promise.all(
      manifests.map(
        async (manifest) =>
          [
            manifest.dist.tarball,
            new Uint8Array(await readFile(new URL(`ms-${manifest.version}.tgz`, fixtureRoot))),
          ] as const,
      ),
    ),
  );
  const local = { calls: { packument: 0, tarball: 0, unknown: 0 } };
  const registry = new RegistryClient({
    baseUrl: 'packument:',
    fetch: async (url) => {
      if (url === 'packument:/ms') {
        local.calls.packument++;
        return Response.json(packument);
      }
      const tarball = tarballs.get(url);
      if (tarball) {
        local.calls.tarball++;
        return new Response(tarball.buffer);
      }
      local.calls.unknown++;
      throw new Error(`unexpected fixture registry URL: ${url}`);
    },
    maxRetries: 0,
  });
  const packumentCache = new Map<string, Packument>();
  const installed = await install({ vfs, cwd: ROOT, registry, packumentCache });
  expect(local.calls).toEqual({ packument: 1, tarball: 1, unknown: 0 });
  expect(installed.provenance.packages).toEqual([
    { name: 'ms', version: '2.0.0', transport: 'registry' },
  ]);
  const expected = await tree(vfs, `${ROOT}/node_modules`);
  await vfs.rm(`${ROOT}/node_modules`, { recursive: true });
  return { vfs, installed, expected, packumentCache, local };
}

async function observedFailure(operation: Promise<unknown>): Promise<Error> {
  const result = await operation.then(
    () => ({ kind: 'success' as const }),
    (error: unknown) => ({ kind: 'failure' as const, error }),
  );
  expect(result.kind, 'required acquisition must not report success').toBe('failure');
  if (result.kind !== 'failure' || !(result.error instanceof Error))
    throw new Error('missing acquisition failure');
  return result.error;
}

function expectUnavailable(error: Error): void {
  expect(error.message).toMatch(
    /registry.*(?:unavailable|disabled|not configured|not available|capability)|(?:unavailable|disabled).*registry|NotImplementedError.*registry/i,
  );
  expect(error.message).not.toMatch(/Cannot read properties|missing InstallOptions/i);
}

describe.each(OVERLOADS)('registry-free install overload: %s', (kind) => {
  it('installs an empty graph without constructing a registry', async () => {
    const vfs = await project({});
    const result = await invoke(kind, { vfs, cwd: ROOT }, {});
    expect(result.packages).toEqual([]);
    expect(result.provenance.packages).toEqual([]);
    expect(result.lockfile.name).toBe('offline-root');
    expect(await vfs.exists(`${ROOT}/package-lock.json`)).toBe(true);
  });

  it('replays the real exact lock and verified tarball cache with no registry', async () => {
    const h = await seeded();
    const result = await invoke(kind, { vfs: h.vfs, cwd: ROOT });
    expect(result.provenance).toEqual({
      resolution: 'lockfile',
      packages: [{ name: 'ms', version: '2.0.0', transport: 'cache' }],
    });
    expect(result.lockfile).toEqual(h.installed.lockfile);
    expect(await tree(h.vfs, `${ROOT}/node_modules`)).toEqual(h.expected);
    expect(h.local.calls).toEqual({ packument: 1, tarball: 1, unknown: 0 });
  });

  it('resolves from real caller metadata plus exact cached bytes when the lock is absent', async () => {
    const h = await seeded();
    await h.vfs.rm(`${ROOT}/package-lock.json`);
    const result = await invoke(kind, { vfs: h.vfs, cwd: ROOT, packumentCache: h.packumentCache });
    expect(result.provenance).toEqual({
      resolution: 'metadata',
      packages: [{ name: 'ms', version: '2.0.0', transport: 'cache' }],
    });
    expect(await tree(h.vfs, `${ROOT}/node_modules`)).toEqual(h.expected);
    expect(h.local.calls).toEqual({ packument: 1, tarball: 1, unknown: 0 });
  });

  it('reports unavailable registry only when required packument metadata is missing', async () => {
    const h = await seeded();
    await h.vfs.rm(`${ROOT}/package-lock.json`);
    const error = await observedFailure(invoke(kind, { vfs: h.vfs, cwd: ROOT }));
    expectUnavailable(error);
  });

  it.each(['missing', 'corrupt'] as const)(
    'refuses a %s required cached tarball without fallback egress',
    async (fault) => {
      const h = await seeded();
      const pin = h.installed.lockfile.packages['node_modules/ms'];
      if (!pin?.integrity) throw new Error('real seed has no integrity');
      const path = tarballCachePath('ms', '2.0.0', pin.integrity);
      if (fault === 'missing') await h.vfs.rm(path);
      else await h.vfs.writeFile(path, new Uint8Array([0, 255, 1]));
      const error = await observedFailure(invoke(kind, { vfs: h.vfs, cwd: ROOT }));
      expectUnavailable(error);
    },
  );

  it('preserves loud rejection of incomplete required lock metadata', async () => {
    const h = await seeded();
    const lock = structuredClone(h.installed.lockfile);
    const pin = lock.packages['node_modules/ms'];
    if (!pin) throw new Error('real seed has no ms pin');
    pin.resolved = undefined;
    await h.vfs.writeFile(`${ROOT}/package-lock.json`, JSON.stringify(lock));
    const error = await observedFailure(invoke(kind, { vfs: h.vfs, cwd: ROOT }));
    expect(error.message).toMatch(/lock|resolved/i);
    expect(error.message).not.toMatch(/Cannot read properties|missing InstallOptions/i);
  });

  it('does not turn an incomplete cached packument into successful installation', async () => {
    const h = await seeded();
    await h.vfs.rm(`${ROOT}/package-lock.json`);
    h.packumentCache.set('ms', { name: 'ms', versions: {} });
    const error = await observedFailure(
      invoke(kind, { vfs: h.vfs, cwd: ROOT, packumentCache: h.packumentCache }),
    );
    expect(error.message).toMatch(/No matching version.*ms/i);
  });

  it.each(['cold', 'locked'] as const)(
    'rejects Eddy with no registry before consuming a real prefetch or requesting a resolver (%s)',
    async (state) => {
      const h = state === 'locked' ? await seeded() : undefined;
      const vfs = h?.vfs ?? (await project());
      const request = { dependencies: DEPS, optionalDependencies: {} };
      const prefetchRequests: string[] = [];
      // The caller-created real prefetch is setup. This install must neither
      // consume it nor create any additional GET/POST acquisition.
      const prefetch = startEddyPrefetch({
        resolverUrl: 'https://eddy.invalid/resolve',
        request,
        fetchImpl: async (input) => {
          prefetchRequests.push(String(input));
          return new Response('not acquired', { status: 404 });
        },
      });
      const callbacks: string[] = [];
      const error = await observedFailure(
        invoke(kind, {
          vfs,
          cwd: ROOT,
          resolverUrl: 'https://eddy.invalid/resolve',
          resolverClosureHash: 'a'.repeat(64),
          resolverPrefetch: prefetch,
          onPackage: () => {
            callbacks.push('package');
          },
          assertPortablePaths: () => {
            callbacks.push('paths');
          },
        }),
      );
      expect(error.message).toMatch(/registry/i);
      expect(error.message).toMatch(/Eddy|resolver/i);
      const retained = prefetch.take(canonicalEddyRequestKey(request, 'cached'));
      expect(retained, 'invalid options must leave real prefetch unconsumed').not.toBeNull();
      if (retained) await (await retained).text();
      expect(prefetchRequests).toEqual(['https://eddy.invalid/resolve']);
      expect(callbacks).toEqual([]);
    },
  );
});

it('does not classify explicit dependency names vfs/cwd as an options object', async () => {
  const dependencies = { vfs: '1.0.0', cwd: '1.0.0' };
  const vfs = await project(dependencies);
  expectUnavailable(
    await observedFailure(invoke('explicit-dependencies', { vfs, cwd: ROOT }, dependencies)),
  );
});

describe.each(['options', 'name-version-options'] as const)(
  'registry-free manifest normalization: %s',
  (kind) => {
    it('retains the existing unsupported root install-script diagnostic', async () => {
      const vfs = await project({});
      await vfs.writeFile(
        `${ROOT}/package.json`,
        JSON.stringify({ name: 'offline-root', scripts: { install: 'echo unsupported' } }),
      );
      const error = await observedFailure(invoke(kind, { vfs, cwd: ROOT }));
      expect(error.message).toContain('npm-client.lifecycle.install');
    });

    it('keeps existing warn-and-skip policy for an unavailable optional dependency', async () => {
      const vfs = await project({});
      await vfs.writeFile(
        `${ROOT}/package.json`,
        JSON.stringify({ name: 'offline-root', optionalDependencies: DEPS }),
      );
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const result = await invoke(kind, { vfs, cwd: ROOT });
        expect(result.packages).toEqual([]);
        expect(warning.mock.calls.flat().join('\n')).toMatch(
          /optional dependency ms@2\.0\.0.*could not be installed/i,
        );
      } finally {
        warning.mockRestore();
      }
    });
  },
);
