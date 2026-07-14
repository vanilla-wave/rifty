/**
 * Playground `npm` shell command over the REAL `@riftydev/npm-client.install`
 * (no `install` stub) against the vendored fixture registry + a REAL eddy
 * server. `npm-shell-command.test.ts` covers the glue's own logic through the
 * documented `install` DI seam; THIS file is the drift tripwire for what a stub
 * cannot vouch for — the real install signature/result shape, the learned-pin
 * write-back carrying the eddy-computed closure hash, the install stamp over a
 * real tree, and the `via eddy (fast)` provenance line.
 */
import type { AddressInfo } from 'node:net';
import {
  RegistryClient,
  type TarballCache,
  canonicalEddyRequestKey,
  install,
  unpackEddyBundle,
} from '@riftydev/npm-client';
import { type CommandContext, Shell } from '@riftydev/shell';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEARNED_PIN_TTL_MS,
  readLearnedPin,
  revalidateLearnedPin,
  writeLearnedPin,
} from '../../apps/playground/src/glue/eddy-learned-pins.ts';
import { installArtifactIdentity } from '../../apps/playground/src/glue/install-artifact-identity.ts';
import {
  createNpmPackageAcquisitionAuthority,
  createNpmShellCommand,
} from '../../apps/playground/src/glue/npm-shell-command.ts';
import { PackageAcquisitionError } from '../../apps/playground/src/workers/package-acquisition-authority.ts';
import { type EddyServer, createEddyServer, resolveBundle } from '../../services/eddy/src/index.ts';
import { LOCAL_REGISTRY_BASE_URL, makeLocalFetcher } from './fixtures/local-registry.ts';

const DEPS = { debug: '^4.4.1' };
const EXPECTED_PACKAGES = [
  { name: 'debug', version: '4.4.1' },
  { name: 'ms', version: '2.1.3' },
] as const;

async function seedProject(vfs: MemoryVfs): Promise<void> {
  await vfs.mkdir('/proj', { recursive: true });
  await vfs.writeFile(
    '/proj/package.json',
    `${JSON.stringify({ name: 'demo', version: '0.0.0', dependencies: DEPS }, null, 2)}\n`,
  );
}

function makeRegistry(): RegistryClient {
  return new RegistryClient({ baseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch });
}

async function runShell(shell: Shell, line: string): Promise<{ exitCode: number; out: string }> {
  const chunks: string[] = [];
  const r = await shell.run(line, {
    onChunk: (chunk, stream) => {
      if (stream === 'stdout') chunks.push(chunk);
    },
  });
  return { exitCode: r.exitCode, out: chunks.join('') };
}

/** The fixture registry is deterministic, so a local resolve computes the same
 * closure hash the eddy server will stamp into its bundle. */
async function expectedClosureHash(): Promise<string> {
  const built = await resolveBundle(
    { dependencies: DEPS },
    { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
  );
  if (built.kind !== 'bundle') throw new Error('setup: expected a bundle');
  return unpackEddyBundle(built.bytes).manifest.asOf.closureHash;
}

let eddy: EddyServer;
let eddyUrl: string;

beforeEach(async () => {
  eddy = createEddyServer({
    registryBaseUrl: LOCAL_REGISTRY_BASE_URL,
    fetch: makeLocalFetcher().fetch,
  });
  await eddy.listen(0);
  eddyUrl = `http://127.0.0.1:${(eddy.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await eddy.close();
});

describe('npm shell command → REAL install → real eddy (stub-drift tripwire)', () => {
  it('production npm adapter preserves both original causes when Eddy and registry fail', async () => {
    const eddyFailure = new Error('eddy connection refused');
    const registryFailure = new Error('registry unavailable');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw eddyFailure;
      }),
    );
    class FailingRegistry extends RegistryClient {
      override async getPackument(): Promise<never> {
        throw registryFailure;
      }
    }

    try {
      const vfs = new MemoryVfs();
      await seedProject(vfs);
      const deps = {
        vfs,
        registry: new FailingRegistry({
          baseUrl: LOCAL_REGISTRY_BASE_URL,
          fetch: makeLocalFetcher().fetch,
        }),
        resolverUrl: 'https://eddy.invalid/resolve',
      };
      const authority = createNpmPackageAcquisitionAuthority(deps);
      const sink = { write: () => {} };
      const context: CommandContext = { cwd: '/proj', env: {}, stdout: sink, stderr: sink };
      let caught: unknown;

      try {
        await authority.dispatch({
          type: 'terminal-install',
          project: {
            projectId: 'integration',
            root: '/proj',
            slug: 'integration',
            identity: installArtifactIdentity,
          },
          argv: [],
          context,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(PackageAcquisitionError);
      const installFailure = (caught as PackageAcquisitionError).cause;
      expect(installFailure).toBeInstanceOf(AggregateError);
      expect((installFailure as AggregateError).errors).toEqual([eddyFailure, registryFailure]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('real Eddy install reports lockfile resolution and per-package Eddy transport', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);

    const result = await install({
      vfs,
      cwd: '/proj',
      registry: makeRegistry(),
      resolverUrl: eddyUrl,
    });

    expect(result.provenance.resolution).toBe('lockfile');
    expect(result.provenance.eddyFallback).toBeUndefined();
    expect(result.provenance.packages).toEqual(
      EXPECTED_PACKAGES.map((pkg) => ({ ...pkg, transport: 'eddy' })),
    );
  });

  it('ensure keeps a same-project covering lock and reinstalls from the real tarball cache', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await install({ vfs, cwd: '/proj', registry: makeRegistry() });
    const packageJsonText = await vfs.readFileText('/proj/package.json');
    await vfs.rm('/proj/node_modules', { recursive: true, force: true });
    let registryCalls = 0;
    const offlineRegistry = new RegistryClient({
      baseUrl: LOCAL_REGISTRY_BASE_URL,
      fetch: async () => {
        registryCalls += 1;
        throw new Error('covering lock + cache must not reach the registry');
      },
    });
    let coveringLockSeen = false;
    const authority = createNpmPackageAcquisitionAuthority({
      vfs,
      registry: offlineRegistry,
      prepareInstall: async (_context, info) => {
        coveringLockSeen = await vfs.exists('/proj/package-lock.json');
        expect(info.priorTrustedTree).toBe(false);
        expect(info.priorSlug).toBeUndefined();
        await vfs.rm('/proj/node_modules', { recursive: true, force: true });
      },
    });

    const provenance = await authority.dispatch({
      type: 'ensure',
      project: {
        projectId: 'integration',
        root: '/proj',
        slug: 'integration',
        identity: installArtifactIdentity,
      },
      packageJsonText,
      fallback: 'install',
      replaceTreeOnMiss: true,
    });

    expect(coveringLockSeen).toBe(true);
    expect(registryCalls).toBe(0);
    expect(provenance).toMatchObject({
      outcome: 'installed',
      resolution: 'lockfile',
      packages: EXPECTED_PACKAGES.map((pkg) => ({ ...pkg, transport: 'cache' })),
    });
    expect(await vfs.exists('/proj/node_modules/debug/package.json')).toBe(true);
  });

  it.each([
    ['HTTP 404', 'http-404', 'post: resolver returned HTTP 404'],
    ['corrupt body', 'corrupt', 'post: truncated eddy bundle tar stream'],
    [
      'divergent closure',
      'divergent',
      'post: bundle lockfile does not cover the request (or an override forces a re-resolve)',
    ],
  ] as const)(
    'records %s as an Eddy fallback before the validating registry succeeds',
    async (_label, failure, expectedReason) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          if (failure === 'http-404') return new Response('', { status: 404 });
          if (failure === 'corrupt') return new Response(new Uint8Array([1, 2, 3]));
          const built = await resolveBundle(
            { dependencies: { ms: '2.1.3' } },
            { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
          );
          if (built.kind !== 'bundle') throw new Error('setup: expected divergent bundle');
          return new Response(built.bytes);
        }),
      );
      try {
        const vfs = new MemoryVfs();
        await seedProject(vfs);
        const result = await install({
          vfs,
          cwd: '/proj',
          registry: makeRegistry(),
          resolverUrl: 'https://eddy.invalid/resolve',
        });

        expect(result.provenance.resolution).toBe('metadata');
        expect(result.provenance.eddyFallback?.reason).toBe(expectedReason);
        expect(result.provenance.packages).toEqual(
          EXPECTED_PACKAGES.map((pkg) => ({ ...pkg, transport: 'registry' })),
        );
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('eddy path: real tree + stamp + learned pin carrying the eddy closure hash + provenance line', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    const pins: Array<{ key: string; hash: string }> = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: makeRegistry(),
        resolverUrl: eddyUrl,
        projectSlug: () => 'glue-e2e',
        learnedPins: {
          get: async () => undefined,
          set: async (key, hash) => {
            pins.push({ key, hash });
          },
          revalidate: async () => {},
        },
      }),
    );

    const { exitCode, out } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(out).toContain('via eddy (fast)');
    // Real tree + lockfile, not a stub's empty result.
    expect(await vfs.exists('/proj/node_modules/debug/package.json')).toBe(true);
    expect(await vfs.exists('/proj/package-lock.json')).toBe(true);
    // Stamp over the REAL package count, keyed on the owner slug. The
    // durability sequence runs in background — wait for it.
    await vi.waitFor(async () => {
      expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(true);
    });
    const stamp = JSON.parse(
      await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json'),
    ) as { slug: string; packages: number };
    expect(stamp.slug).toBe('glue-e2e');
    expect(stamp.packages).toBeGreaterThan(0);
    // The learned pin rides the REAL eddy-computed closure hash under the
    // canonical post-merge request key.
    expect(pins).toEqual([
      {
        key: canonicalEddyRequestKey({ dependencies: DEPS, optionalDependencies: {} }),
        hash: await expectedClosureHash(),
      },
    ]);
  });

  it('learned-pin loop: the first eddy install TEACHES the pin; a later FRESH PROJECT rides GET-by-hash with zero POSTs (round 16)', async () => {
    // The ADR-0194 promise end-to-end: same profile (one learned-pin store),
    // two projects. Cold install POSTs and writes the pin; the second
    // project's identical dep set turns into a cacheable GET.
    const methods: string[] = [];
    eddy.raw.on('request', (req) => {
      methods.push(req.method ?? '');
    });
    const pinStore = new Map<string, string>();
    const learnedPins = {
      get: async (key: string) => {
        const hash = pinStore.get(key);
        return hash === undefined ? undefined : { closureHash: hash, stale: false };
      },
      set: async (key: string, hash: string) => {
        pinStore.set(key, hash);
      },
      revalidate: async () => {},
    };

    const vfs1 = new MemoryVfs();
    await seedProject(vfs1);
    const shell1 = new Shell({ cwd: '/proj' });
    shell1.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs: vfs1,
        registry: makeRegistry(),
        resolverUrl: eddyUrl,
        learnedPins,
      }),
    );
    const first = await runShell(shell1, 'npm install');
    await new Promise((r) => setTimeout(r, 0)); // fire-and-forget pin write-back
    expect(first.exitCode).toBe(0);
    expect(first.out).toContain('via eddy (fast)');
    expect(methods).toContain('POST'); // cold: taught by the resolve
    expect(pinStore.size).toBe(1);
    methods.length = 0;

    const vfs2 = new MemoryVfs(); // a FRESH project tree, same profile pin store
    await seedProject(vfs2);
    const shell2 = new Shell({ cwd: '/proj' });
    shell2.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs: vfs2,
        registry: makeRegistry(),
        resolverUrl: eddyUrl,
        learnedPins,
      }),
    );
    const second = await runShell(shell2, 'npm install');
    expect(second.exitCode).toBe(0);
    expect(second.out).toContain('via eddy (fast)');
    expect(methods).toContain('GET'); // the learned pin carried it…
    expect(methods.filter((m) => m === 'POST')).toEqual([]); // …with ZERO POSTs
  });

  it('stale-pin SWR end-to-end: a 31-min pin rides the GET with the as-of line, the REAL revalidate refreshes it, the next install observes a fresh pin', async () => {
    // The eddy-stale-pin-revalidate acceptance over a REAL server + REAL pin
    // store (no seam stubs): teach → age past the fresh TTL → stale serve
    // (honesty line, zero POST during install) → background manifest-only
    // POST revalidate → the pin reads back fresh; a later install stays
    // silent and rides the GET again.
    const profileVfs = new MemoryVfs(); // one profile: the pin store lives here
    await seedProject(profileVfs);
    const requestKey = canonicalEddyRequestKey({ dependencies: DEPS, optionalDependencies: {} });
    const learnedPins = {
      get: (key: string) => readLearnedPin(profileVfs, key),
      set: (key: string, hash: string) => writeLearnedPin(profileVfs, key, hash),
      revalidate: async (_key: string, request: never, servedHash: string) => {
        await revalidateLearnedPin({
          vfs: profileVfs,
          resolverUrl: eddyUrl,
          request,
          staleClosureHash: servedHash,
        });
      },
    };
    const makeShell = (vfs: MemoryVfs): Shell => {
      const shell = new Shell({ cwd: '/proj' });
      shell.registerCommand(
        'npm',
        createNpmShellCommand({ vfs, registry: makeRegistry(), resolverUrl: eddyUrl, learnedPins }),
      );
      return shell;
    };

    // Teach: the first install POSTs, seeds the store, learns the pin.
    const first = await runShell(makeShell(profileVfs), 'npm install');
    expect(first.exitCode).toBe(0);
    await vi.waitFor(async () => {
      expect(await readLearnedPin(profileVfs, requestKey)).toBeDefined();
    });
    const taught = await readLearnedPin(profileVfs, requestKey);

    // Age the pin past the fresh TTL (31 min) — inside the stale window.
    await writeLearnedPin(
      profileVfs,
      requestKey,
      (taught as { closureHash: string }).closureHash,
      () => Date.now() - (LEARNED_PIN_TTL_MS + 60_000),
    );

    const methods: string[] = [];
    eddy.raw.on('request', (req) => {
      methods.push(req.method ?? '');
    });
    const vfs2 = new MemoryVfs();
    await seedProject(vfs2);
    const second = await runShell(makeShell(vfs2), 'npm install');
    expect(second.exitCode).toBe(0);
    expect(second.out).toContain('via eddy (fast)');
    expect(second.out).toMatch(
      /npm: eddy cached resolution \(as-of .+\), refreshing in background/,
    );
    // The install itself rode the cacheable GET (stale-served, no foreground POST)…
    expect(methods[0]).toBe('GET');
    // …and the background revalidate refreshes the pin via ONE POST.
    await vi.waitFor(async () => {
      expect(await readLearnedPin(profileVfs, requestKey)).toEqual({
        closureHash: (taught as { closureHash: string }).closureHash,
        stale: false,
      });
    });
    expect(methods).toContain('POST');

    // The next install observes the refreshed pin: silent, GET-only.
    methods.length = 0;
    const vfs3 = new MemoryVfs();
    await seedProject(vfs3);
    const third = await runShell(makeShell(vfs3), 'npm install');
    expect(third.exitCode).toBe(0);
    expect(third.out).not.toContain('eddy cached resolution');
    expect(methods.filter((m) => m === 'POST')).toEqual([]);
  });

  it('concurrent installs of the SAME dep set: last-writer-wins on the pin file, both installs correct', async () => {
    // Fault row (eddy-stale-pin-revalidate): two projects, one profile pin
    // store, racing fire-and-forget write-backs. The file must stay valid
    // JSON holding the canonical key → correct hash; both installs succeed.
    // The overlap assert keeps the row honest: the per-tree install mutex is
    // keyed by (vfs, cwd) — two DIFFERENT trees that happen to share a path
    // string must run concurrently, or this test silently serializes and
    // proves nothing about racing write-backs.
    const profileVfs = new MemoryVfs();
    await seedProject(profileVfs);
    const vfsB = new MemoryVfs();
    await seedProject(vfsB);
    const learnedPins = {
      get: (key: string) => readLearnedPin(profileVfs, key),
      set: (key: string, hash: string) => writeLearnedPin(profileVfs, key, hash),
      revalidate: async () => {},
    };
    let inFlight = 0;
    let maxInFlight = 0;
    const overlapProbedInstall: typeof install = async (...args: Parameters<typeof install>) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await install(...args);
      } finally {
        inFlight -= 1;
      }
    };
    const shellFor = (vfs: MemoryVfs): Shell => {
      const shell = new Shell({ cwd: '/proj' });
      shell.registerCommand(
        'npm',
        createNpmShellCommand({
          vfs,
          registry: makeRegistry(),
          resolverUrl: eddyUrl,
          learnedPins,
          install: overlapProbedInstall,
        }),
      );
      return shell;
    };

    const [a, b] = await Promise.all([
      runShell(shellFor(profileVfs), 'npm install'),
      runShell(shellFor(vfsB), 'npm install'),
    ]);

    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    expect(maxInFlight).toBe(2); // genuinely concurrent — not phase-lock serialized
    const requestKey = canonicalEddyRequestKey({ dependencies: DEPS, optionalDependencies: {} });
    await vi.waitFor(async () => {
      expect((await readLearnedPin(profileVfs, requestKey))?.closureHash).toBe(
        await expectedClosureHash(),
      );
    });
  });

  it('standard path (no resolverUrl): real install, stamp written, pins never touched', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    let pinCalls = 0;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: makeRegistry(),
        learnedPins: {
          get: async () => {
            pinCalls++;
            return undefined;
          },
          set: async () => {
            pinCalls++;
          },
          revalidate: async () => {
            pinCalls++;
          },
        },
      }),
    );

    const { exitCode, out } = await runShell(shell, 'npm install');
    await new Promise((r) => setTimeout(r, 0));

    expect(exitCode).toBe(0);
    expect(out).not.toContain('via eddy');
    expect(await vfs.exists('/proj/node_modules/debug/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(true);
    expect(pinCalls).toBe(0); // learned pins are eddy-only (inert without resolverUrl)
  });

  it('a NON-RETENTIVE tarball cache declines eddy — never claims source=eddy over registry bytes (provenance guard)', async () => {
    // InstallOptions.tarballCache documents a no-op instance to disable caching.
    // eddy adoption seeds the cache then REPLAYS the install by reading it back;
    // a cache that never retains would re-fetch every package from the REGISTRY
    // under an `eddy` label (a provenance lie, and a hard failure if the
    // registry is down). The retention probe must decline to the standard path.
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    const noop: TarballCache = { get: async () => null, put: async () => '' };
    const result = await install({
      vfs,
      cwd: '/proj',
      registry: makeRegistry(),
      resolverUrl: eddyUrl,
      tarballCache: noop,
    });
    // The bundle really arrives + verifies over the wire, yet adoption is
    // refused because the cache can't back the replay — honestly `standard`.
    expect(result.source ?? 'standard').toBe('standard');
    expect(result.provenance.eddyFallback?.reason).toContain(
      'tarball cache did not retain seeded bytes',
    );
    expect(result.provenance.packages.every((pkg) => pkg.transport === 'registry')).toBe(true);
    // The standard path still installs (real tree), it just isn't labelled eddy.
    expect(await vfs.exists('/proj/node_modules/debug/package.json')).toBe(true);
  });

  it('a cache that retained only the last seeded tarball declines eddy — every bundle tarball must survive replay', async () => {
    // A small bounded cache can pass a "last seeded tarball exists" probe while
    // evicting earlier bundle members. That would replay those earlier packages
    // from the registry under an eddy label. Adoption must prove all seeds.
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    let retained:
      | {
          key: string;
          bytes: Uint8Array;
        }
      | undefined;
    const oneEntryCache: TarballCache = {
      async get(name, version, integrity) {
        return retained?.key === `${name}@${version}@${integrity}` ? retained.bytes : null;
      },
      async put(name, version, integrity, bytes) {
        retained = { key: `${name}@${version}@${integrity}`, bytes };
        return '';
      },
    };

    const result = await install({
      vfs,
      cwd: '/proj',
      registry: makeRegistry(),
      resolverUrl: eddyUrl,
      tarballCache: oneEntryCache,
    });

    expect(result.source ?? 'standard').toBe('standard');
    expect(result.provenance.eddyFallback?.reason).toContain(
      'tarball cache did not retain seeded bytes',
    );
    expect(new Set(result.provenance.packages.map((pkg) => pkg.transport))).toEqual(
      new Set(['cache', 'registry']),
    );
    expect(await vfs.exists('/proj/node_modules/debug/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/ms/package.json')).toBe(true);
  });

  it('a resolver that stalls a JSON decline body falls back within the bound — never parks the install', async () => {
    // The eddy attempts fetch via GLOBAL fetch. A resolver (or a URL-keyed
    // proxy) can send `content-type: application/json` then hold the body open
    // forever: `response.json()` has NO timeout, so the JSON-decline branch used
    // to park `npm install` indefinitely, bypassing resolverStallTimeoutMs.
    const enc = new TextEncoder();
    const hangingJson = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(enc.encode('{"feat')); // partial JSON, never closes
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => hangingJson()),
    );
    try {
      const vfs = new MemoryVfs();
      await seedProject(vfs);
      const result = await install({
        vfs,
        cwd: '/proj',
        registry: makeRegistry(), // its own injected fetch — untouched by the stub
        resolverUrl: 'http://resolver.invalid',
        resolverStallTimeoutMs: 50,
      });
      // Bounded → the eddy attempt declines → standard install completes.
      expect(result.source ?? 'standard').toBe('standard');
      expect(result.provenance.eddyFallback?.reason).toContain(
        'resolver decline body stalled or exceeded its byte cap',
      );
      expect(result.provenance.packages.every((pkg) => pkg.transport === 'registry')).toBe(true);
      expect(await vfs.exists('/proj/node_modules/debug/package.json')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
