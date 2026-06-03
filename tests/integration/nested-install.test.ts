/**
 * Vendored-tarball nested-install regression test (ADR-0042, ADR-0021).
 *
 * Exercises the first-wins-flat + nest-on-conflict placement rule end-to-end
 * against a real diamond, using real `.tgz` bytes through the same fixture
 * registry that `real-install.test.ts` uses.
 *
 * The diamond shape (the minimal, vendored mirror of the live `express`
 * conflict that `tests/integration/express-live.opt-in.test.ts` reproduces):
 *
 *     root
 *      ├── debug@^4.4.1            (real npm tarball, MIT)
 *      │     └── ms: ^2.1.3        → wins flat at node_modules/ms/ (2.1.3)
 *      └── diamond-conflict-parent@1.0.0  (vendored synthetic wrapper, MIT)
 *            └── ms: 2.0.0         → nests at
 *                                    node_modules/diamond-conflict-parent/
 *                                      node_modules/ms/  (2.0.0)
 *
 * Why a synthesized wrapper instead of a real package? Every real candidate
 * that pins `ms@2.0.0` exact (`finalhandler`, `morgan`, `body-parser`, the
 * old express ecosystem) drags in too many transitive deps to vendor cheaply.
 * The wrapper is 613 bytes of real tar with a single declared dependency;
 * see `tools/integration-fixtures/diamond-conflict-parent/README.md` for the
 * re-pack flow.
 *
 * If `walkAndPin`'s nest-on-conflict branch regresses, the placement
 * assertions below fail loudly — the second `ms` either ends up where the
 * first one is (overwriting flat), refuses to install (revives
 * `EVERSIONCONFLICT`), or lands at the wrong nested path. All three
 * surface as concrete failed expects below.
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

describe('integration — nested install diamond (ADR-0042) via vendored tarballs', () => {
  it('places the first-seen ms version flat and nests the conflicting copy under its parent', async () => {
    const vfs = new MemoryVfs();
    const { registry } = makeRegistry();

    const result = await install(
      'root',
      '0.0.0',
      { debug: '^4.4.1', 'diamond-conflict-parent': '1.0.0' },
      { vfs, cwd: '/app', registry },
    );

    // Both top-level deps installed flat.
    expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    expect(await vfs.exists('/app/node_modules/diamond-conflict-parent/package.json')).toBe(true);

    // `ms@2.1.3` (debug's transitive request) wins the flat slot because
    // debug is visited before the wrapper under the M11 walk order
    // (Object.entries-order). If first-wins-flat regresses (e.g. `walkAndPin`
    // unconditionally overwrites or skips), this fails.
    const flatMsPkg = JSON.parse(await vfs.readFileText('/app/node_modules/ms/package.json')) as {
      version: string;
    };
    expect(flatMsPkg.version).toBe('2.1.3');

    // `ms@2.0.0` (wrapper's request) gets nested under the wrapper.
    // This is the exact branch that regresses if nest-on-conflict is removed
    // — without it, `walkAndPin` would either silently dedupe `ms@2.0.0` to
    // the flat 2.1.3 slot (wrong: `2.0.0 !== 2.1.3`, so the wrapper's
    // contractually-pinned `ms@2.0.0` would silently turn into 2.1.3) or
    // throw EVERSIONCONFLICT (revived pre-M11 behaviour).
    const nestedMsPath = '/app/node_modules/diamond-conflict-parent/node_modules/ms/package.json';
    expect(await vfs.exists(nestedMsPath)).toBe(true);
    const nestedMsPkg = JSON.parse(await vfs.readFileText(nestedMsPath)) as { version: string };
    expect(nestedMsPkg.version).toBe('2.0.0');

    // The two `ms` copies are distinct entries in the result set (one per
    // install path) — important for the lockfile assertion below and for any
    // future consumer that walks `result.packages` by path.
    const msResolved = result.packages.filter((p) => p.name === 'ms');
    expect(msResolved.length).toBe(2);
    const versions = msResolved.map((p) => p.version).sort();
    expect(versions).toEqual(['2.0.0', '2.1.3']);

    // Lockfile keys carry the actual install path (npm v3 shape — see
    // ADR-0042 §"fast-path opt-out"). Both `ms` entries coexist with
    // distinct keys.
    const lockText = await vfs.readFileText('/app/package-lock.json');
    const lock = JSON.parse(lockText) as {
      lockfileVersion: number;
      packages: Record<string, { version: string }>;
    };
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages['node_modules/ms']?.version).toBe('2.1.3');
    expect(lock.packages['node_modules/diamond-conflict-parent/node_modules/ms']?.version).toBe(
      '2.0.0',
    );
    expect(lock.packages['node_modules/debug']?.version).toBe('4.4.1');
    expect(lock.packages['node_modules/diamond-conflict-parent']?.version).toBe('1.0.0');

    // Conflicts retained as an empty array since A-031; M11 nested install
    // never populates it.
    expect(result.conflicts).toEqual([]);
  });

  it('reinstall replays nested placement from the lockfile fast path (no packument round-trips)', async () => {
    // ADR-0042 originally opted the lockfile fast path out whenever the
    // lockfile carried nested entries — `chooseSource` fell through to
    // live-resolve in that case, costing one extra packument round-trip per
    // package on every reinstall of any project with a diamond conflict.
    // The ADR-0042 follow-on (this PR) lifts that opt-out: the fast path
    // now does parent-aware walk-up lookups (see `pinnedEntryForParent`
    // in `installer-lockfile-reader.ts`), so a reinstall against a
    // nested-entry lockfile replays exclusively from the lockfile + tarball
    // cache and never hits the network. The packument-count flip
    // (`toBeGreaterThan(0) → toBe(0)`) IS the regression detector for the
    // new fast-path behaviour.
    //
    // Loader resolution from the nested copy is intentionally out of scope
    // here — the placement + lockfile contract IS the regression detector
    // for `walkAndPin`. A loader-level parity test on nested resolution can
    // come later as a follow-up if needed.
    const vfs = new MemoryVfs();

    const first = makeRegistry();
    const firstResult = await install(
      'root',
      '0.0.0',
      { debug: '^4.4.1', 'diamond-conflict-parent': '1.0.0' },
      { vfs, cwd: '/app', registry: first.registry },
    );
    const firstLock = await vfs.readFileText('/app/package-lock.json');

    const second = makeRegistry();
    const secondResult = await install(
      'root',
      '0.0.0',
      { debug: '^4.4.1', 'diamond-conflict-parent': '1.0.0' },
      { vfs, cwd: '/app', registry: second.registry },
    );
    const secondLock = await vfs.readFileText('/app/package-lock.json');

    expect(secondLock).toBe(firstLock);
    // Tarballs come from the cache on the second pass — cache hits, no re-fetch.
    expect(second.calls.tarball).toBe(0);
    // Post-follow-on: the fast path now handles nested entries via the
    // walk-up helper, so no packument round-trips either. The whole
    // install is a pure replay of the lockfile + tarball cache.
    expect(second.calls.packument).toBe(0);

    // Same nested layout still on disk.
    expect(
      await vfs.exists('/app/node_modules/diamond-conflict-parent/node_modules/ms/package.json'),
    ).toBe(true);

    // Resolved set has the same install-path shape both times — the fast
    // path's walk-up placement matches what live-resolve produced on the
    // first pass. Sorted-deep-equal catches any silent path drift.
    const firstPaths = firstResult.packages
      .map((p) => p.installPath ?? `node_modules/${p.name}`)
      .sort();
    const secondPaths = secondResult.packages
      .map((p) => p.installPath ?? `node_modules/${p.name}`)
      .sort();
    expect(secondPaths).toEqual(firstPaths);
  });
});
