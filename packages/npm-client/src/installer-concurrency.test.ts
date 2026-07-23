import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';

interface FakeRegistryEntry {
  manifest: VersionManifest;
  tarball: Uint8Array;
}

/**
 * Counting + delayed registry. `getTarball` records a call per resolved URL and
 * awaits a microtask-delay so several fetches are genuinely in flight at once —
 * the only way to exercise the bounded-semaphore overlap and the in-flight
 * dedupe (#24). FakeRegistry in installer.test.ts resolves synchronously, so it
 * can't surface concurrency; this one can.
 */
class CountingDelayedRegistry extends RegistryClient {
  private readonly db: Map<string, Map<string, FakeRegistryEntry>>;
  readonly tarballCalls = new Map<string, number>();
  /** (name,version) keys whose getTarball should reject (simulated bad optional). */
  readonly rejectKeys = new Set<string>();

  constructor(db: Map<string, Map<string, FakeRegistryEntry>>) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.db = db;
  }

  override async getPackument(name: string): Promise<Packument> {
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fake registry: no packument for ${name}`);
    const versionsMap: Record<string, VersionManifest> = {};
    for (const [v, entry] of versions) versionsMap[v] = entry.manifest;
    const sorted = [...versions.keys()].sort();
    const latest = sorted[sorted.length - 1] ?? '0.0.0';
    return { name, 'dist-tags': { latest }, versions: versionsMap };
  }

  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    const match = /^fake:\/\/([^/]+)\/(.+)$/.exec(tarballUrl);
    if (!match) throw new Error(`fake registry: bad tarball url ${tarballUrl}`);
    const [, name, version] = match;
    const key = `${name}@${version}`;
    this.tarballCalls.set(key, (this.tarballCalls.get(key) ?? 0) + 1);
    // Artificial async gap so concurrent requests overlap.
    await new Promise((r) => setTimeout(r, 5));
    if (this.rejectKeys.has(key)) {
      throw new Error(`simulated fetch failure for ${key}`);
    }
    const entry = this.db.get(name ?? '')?.get(version ?? '');
    if (!entry) throw new Error(`fake registry: no tarball for ${tarballUrl}`);
    return entry.tarball;
  }
}

/**
 * Records the PEAK number of `getTarball` calls in flight at once via a live
 * gauge: increment on enter, await a gap so siblings overlap, decrement on exit.
 * `peakInFlight` is the high-water mark — the in-flight half of #24 (the dedupe
 * + determinism halves are covered elsewhere). A serial `await visit` fetch
 * keeps this at 1; the bounded-semaphore deferred fetch drives it above 1.
 */
class GaugeRegistry extends RegistryClient {
  private readonly db: Map<string, Map<string, FakeRegistryEntry>>;
  private inFlight = 0;
  peakInFlight = 0;

  constructor(db: Map<string, Map<string, FakeRegistryEntry>>) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.db = db;
  }

  override async getPackument(name: string): Promise<Packument> {
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fake registry: no packument for ${name}`);
    const versionsMap: Record<string, VersionManifest> = {};
    for (const [v, entry] of versions) versionsMap[v] = entry.manifest;
    const sorted = [...versions.keys()].sort();
    const latest = sorted[sorted.length - 1] ?? '0.0.0';
    return { name, 'dist-tags': { latest }, versions: versionsMap };
  }

  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    const match = /^fake:\/\/([^/]+)\/(.+)$/.exec(tarballUrl);
    if (!match) throw new Error(`fake registry: bad tarball url ${tarballUrl}`);
    const [, name, version] = match;
    this.inFlight++;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    try {
      // Hold the permit long enough that concurrently-scheduled fetches overlap.
      await new Promise((r) => setTimeout(r, 5));
      const entry = this.db.get(name ?? '')?.get(version ?? '');
      if (!entry) throw new Error(`fake registry: no tarball for ${tarballUrl}`);
      return entry.tarball;
    } finally {
      this.inFlight--;
    }
  }
}

/**
 * Same live gauge as GaugeRegistry, but on packument metadata fetches. The
 * placement walk must stay serial, so this only proves metadata prefetch overlap.
 */
class PackumentGaugeRegistry extends RegistryClient {
  private readonly db: Map<string, Map<string, FakeRegistryEntry>>;
  private inFlight = 0;
  peakInFlight = 0;

  constructor(db: Map<string, Map<string, FakeRegistryEntry>>) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.db = db;
  }

  override async getPackument(name: string): Promise<Packument> {
    this.inFlight++;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    try {
      await new Promise((r) => setTimeout(r, 5));
      const versions = this.db.get(name);
      if (!versions) throw new Error(`fake registry: no packument for ${name}`);
      const versionsMap: Record<string, VersionManifest> = {};
      for (const [v, entry] of versions) versionsMap[v] = entry.manifest;
      const sorted = [...versions.keys()].sort();
      const latest = sorted[sorted.length - 1] ?? '0.0.0';
      return { name, 'dist-tags': { latest }, versions: versionsMap };
    } finally {
      this.inFlight--;
    }
  }

  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    const match = /^fake:\/\/([^/]+)\/(.+)$/.exec(tarballUrl);
    if (!match) throw new Error(`fake registry: bad tarball url ${tarballUrl}`);
    const [, name, version] = match;
    const entry = this.db.get(name ?? '')?.get(version ?? '');
    if (!entry) throw new Error(`fake registry: no tarball for ${tarballUrl}`);
    return entry.tarball;
  }
}

async function makeEntry(
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
  optionalDependencies: Record<string, string> = {},
): Promise<FakeRegistryEntry> {
  return {
    manifest: {
      name,
      version,
      dependencies,
      ...(Object.keys(optionalDependencies).length > 0 ? { optionalDependencies } : {}),
      dist: { tarball: `fake://${name}/${version}` },
    },
    tarball: await makePackageTarball(name, version),
  };
}

/** The live express diamond: ms@2.1.3 flat (debug's req, visited first),
 * ms@2.0.0 nested under finalhandler. Shared by the determinism tests. */
async function expressDiamondDb(): Promise<Map<string, Map<string, FakeRegistryEntry>>> {
  const db = new Map<string, Map<string, FakeRegistryEntry>>();
  db.set(
    'express',
    new Map([
      ['4.21.0', await makeEntry('express', '4.21.0', { debug: '^2.6.9', finalhandler: '^1.3.0' })],
    ]),
  );
  db.set('debug', new Map([['2.6.9', await makeEntry('debug', '2.6.9', { ms: '^2.1.0' })]]));
  db.set(
    'finalhandler',
    new Map([['1.3.0', await makeEntry('finalhandler', '1.3.0', { ms: '2.0.0' })]]),
  );
  db.set(
    'ms',
    new Map([
      ['2.0.0', await makeEntry('ms', '2.0.0')],
      ['2.1.3', await makeEntry('ms', '2.1.3')],
    ]),
  );
  return db;
}

describe('install — deterministic layout under bounded-concurrency fetch (#24)', () => {
  it('produces byte-identical layout on every run (express diamond, 20x)', async () => {
    const snapshots: string[] = [];
    for (let run = 0; run < 20; run++) {
      const registry = new CountingDelayedRegistry(await expressDiamondDb());
      const vfs = new MemoryVfs();
      await vfs.mkdir('/proj', { recursive: true });
      const result = await install(
        'root',
        '1.0.0',
        { express: '^4' },
        { vfs, cwd: '/proj', registry },
      );
      // Canonicalize the lockfile package keys → versions; this is the layout.
      const layout: Record<string, string> = {};
      for (const [key, entry] of Object.entries(result.lockfile.packages)) {
        layout[key] = entry.version;
      }
      snapshots.push(JSON.stringify(layout, Object.keys(layout).sort()));
    }
    // Every run identical, and the express-diamond first-wins contract holds.
    const first = snapshots[0];
    for (const s of snapshots) expect(s).toBe(first);
    const layout = JSON.parse(first ?? '{}') as Record<string, string>;
    expect(layout['node_modules/ms']).toBe('2.1.3');
    expect(layout['node_modules/finalhandler/node_modules/ms']).toBe('2.0.0');
  });

  it('fetches each distinct (name,version) tarball exactly once (no double-fetch under concurrency)', async () => {
    const registry = new CountingDelayedRegistry(await expressDiamondDb());
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install('root', '1.0.0', { express: '^4' }, { vfs, cwd: '/proj', registry });
    // ms appears at two install paths but as two distinct versions → 2 keys, 1 each.
    expect(registry.tarballCalls.get('ms@2.1.3')).toBe(1);
    expect(registry.tarballCalls.get('ms@2.0.0')).toBe(1);
    expect(registry.tarballCalls.get('express@4.21.0')).toBe(1);
    expect(registry.tarballCalls.get('debug@2.6.9')).toBe(1);
    expect(registry.tarballCalls.get('finalhandler@1.3.0')).toBe(1);
  });

  it('collapses concurrent same-(name,version) fetches to one network call (in-flight dedupe)', async () => {
    // Two independent parents request the SAME version of `shared`; under the
    // deferred-fetch walk both are scheduled before either lands. The flat-slot
    // dedupe already covers the second visit, but this also locks the call count.
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('p', new Map([['1.0.0', await makeEntry('p', '1.0.0', { shared: '1.0.0' })]]));
    db.set('q', new Map([['1.0.0', await makeEntry('q', '1.0.0', { shared: '1.0.0' })]]));
    db.set('shared', new Map([['1.0.0', await makeEntry('shared', '1.0.0')]]));
    const registry = new CountingDelayedRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install('root', '1.0.0', { p: '1.0.0', q: '1.0.0' }, { vfs, cwd: '/proj', registry });
    expect(registry.tarballCalls.get('shared@1.0.0')).toBe(1);
  });

  it('runs multiple tarball fetches concurrently (peak in-flight > 1)', async () => {
    // The express diamond has 5 distinct (name,version) tarballs, all required.
    // With the deferred bounded-semaphore fetch they overlap; a serial
    // `await visit` fetch would run them one at a time (peak === 1).
    const registry = new GaugeRegistry(await expressDiamondDb());
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install('root', '1.0.0', { express: '^4' }, { vfs, cwd: '/proj', registry });
    // Strict: serial would cap at 1; concurrent fetch lifts it above 1.
    expect(registry.peakInFlight).toBeGreaterThan(1);
  });

  it('prefetches sibling packuments concurrently without perturbing express diamond layout', async () => {
    const registry = new PackumentGaugeRegistry(await expressDiamondDb());
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const result = await install(
      'root',
      '1.0.0',
      { express: '^4' },
      { vfs, cwd: '/proj', registry },
    );

    expect(registry.peakInFlight).toBeGreaterThan(1);
    expect(result.lockfile.packages['node_modules/ms']?.version).toBe('2.1.3');
    expect(result.lockfile.packages['node_modules/finalhandler/node_modules/ms']?.version).toBe(
      '2.0.0',
    );
  });
});

describe('install — optional-dep fetch failure stays non-fatal under concurrency (#24)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns and skips when an optional dep tarball fetch rejects (required deps still land)', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    // root → main(req) ; main has an optional `native` whose tarball fetch fails.
    db.set('main', new Map([['1.0.0', await makeEntry('main', '1.0.0', {}, { native: '1.0.0' })]]));
    db.set('native', new Map([['1.0.0', await makeEntry('native', '1.0.0')]]));
    const registry = new CountingDelayedRegistry(db);
    registry.rejectKeys.add('native@1.0.0'); // simulate a fetch that fails

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    // Must NOT throw — optional failure is warned, not fatal.
    const result = await install(
      'root',
      '1.0.0',
      { main: '1.0.0' },
      { vfs, cwd: '/proj', registry },
    );

    // Required dep landed.
    expect(await vfs.exists('/proj/node_modules/main/package.json')).toBe(true);
    expect(result.lockfile.packages['node_modules/main']?.version).toBe('1.0.0');
    // Optional dep skipped, with the exact warn message.
    const warned = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      warned.some((m) =>
        m.includes('optional dependency native@1.0.0 of main could not be installed'),
      ),
    ).toBe(true);
  });

  it('skips the ENTIRE optional subtree when an optional dep tarball fetch rejects (no orphaned grandchild)', async () => {
    // root → main(req) → opt(optional, fetch REJECTS) → grandchild(req).
    // The old serial walk awaited opt's fetch before recursing, so a failed opt
    // fetch threw before grandchild was ever visited → the whole opt subtree was
    // skipped (npm parity). The deferred-fetch walk must reproduce this: neither
    // opt NOR grandchild is pinned / on disk. (Regression: the buggy deferred
    // code recursed first, orphaning grandchild with no dependent.)
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('main', new Map([['1.0.0', await makeEntry('main', '1.0.0', {}, { opt: '1.0.0' })]]));
    db.set('opt', new Map([['1.0.0', await makeEntry('opt', '1.0.0', { grandchild: '1.0.0' })]]));
    db.set('grandchild', new Map([['1.0.0', await makeEntry('grandchild', '1.0.0')]]));
    const registry = new CountingDelayedRegistry(db);
    registry.rejectKeys.add('opt@1.0.0'); // optional dep's tarball fetch fails

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    // Must NOT throw — optional failure is warned, not fatal.
    const result = await install(
      'root',
      '1.0.0',
      { main: '1.0.0' },
      { vfs, cwd: '/proj', registry },
    );

    // Exact lockfile keys: only root ('') + main. opt skipped, grandchild NOT
    // orphaned.
    expect(Object.keys(result.lockfile.packages).sort()).toEqual(['', 'node_modules/main']);
    // On-disk: main present, neither opt nor grandchild written.
    expect(await vfs.exists('/proj/node_modules/main/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/opt/package.json')).toBe(false);
    expect(await vfs.exists('/proj/node_modules/grandchild/package.json')).toBe(false);
    // The optional skip was warned with the exact message.
    const warned = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      warned.some((m) =>
        m.includes('optional dependency opt@1.0.0 of main could not be installed'),
      ),
    ).toBe(true);
  });

  it('CHARACTERIZATION: salvages surviving required grandchildren of an optional whose subtree partially fails (DIVERGES from npm atomic-rollback) — Q-2026-06-07-324', async () => {
    // root → main(req) → opt(OPTIONAL, fetch OK) → [gcOK(req, fetch OK),
    //                                               gcFail(req, fetch REJECTS)].
    // CURRENT rifty behavior (pinned here): opt fetches OK at the optional
    // boundary (awaited before recursing) and is kept; its required children are
    // deferred fetches inheriting opt's optional descriptor — gcOK lands, gcFail
    // is warned-and-skipped. So opt + gcOK SURVIVE despite gcFail failing.
    //
    // npm DIVERGENCE: real npm treats the optional subtree atomically — a failed
    // required grandchild rolls back the ENTIRE opt subtree (opt, gcOK, gcFail
    // all absent). rifty SALVAGES the surviving required siblings instead.
    // Flipping to npm atomic-rollback is a separate IRREVERSIBLE Node-parity
    // decision (its own future ADR); this test pins the provisional current
    // behavior so that flip cannot happen silently. See Q-2026-06-07-324.
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('main', new Map([['1.0.0', await makeEntry('main', '1.0.0', {}, { opt: '1.0.0' })]]));
    db.set(
      'opt',
      new Map([['1.0.0', await makeEntry('opt', '1.0.0', { gcOK: '1.0.0', gcFail: '1.0.0' })]]),
    );
    db.set('gcOK', new Map([['1.0.0', await makeEntry('gcOK', '1.0.0')]]));
    db.set('gcFail', new Map([['1.0.0', await makeEntry('gcFail', '1.0.0')]]));
    const registry = new CountingDelayedRegistry(db);
    registry.rejectKeys.add('gcFail@1.0.0'); // a REQUIRED grandchild's fetch fails

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    // Non-fatal: the failure surfaces only as a warn (attributed to the optional
    // boundary), never a throw.
    const result = await install(
      'root',
      '1.0.0',
      { main: '1.0.0' },
      { vfs, cwd: '/proj', registry },
    );

    // SALVAGE: main + opt + gcOK pinned; gcFail skipped. (npm would have none of
    // the opt subtree.)
    expect(Object.keys(result.lockfile.packages).sort()).toEqual([
      '',
      'node_modules/gcOK',
      'node_modules/main',
      'node_modules/opt',
    ]);
    // On-disk mirrors the lockfile: the survivors landed, gcFail did not.
    expect(await vfs.exists('/proj/node_modules/main/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/opt/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/gcOK/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/gcFail/package.json')).toBe(false);
    // The skip is attributed to the optional boundary (opt of main), since the
    // failed grandchild inherits opt's optional descriptor.
    const warned = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      warned.some((m) =>
        m.includes('optional dependency opt@1.0.0 of main could not be installed'),
      ),
    ).toBe(true);
  });

  it('a failed REQUIRED dep fetch still rejects the install', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('main', new Map([['1.0.0', await makeEntry('main', '1.0.0', { req: '1.0.0' })]]));
    db.set('req', new Map([['1.0.0', await makeEntry('req', '1.0.0')]]));
    const registry = new CountingDelayedRegistry(db);
    registry.rejectKeys.add('req@1.0.0');

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    await expect(
      install('root', '1.0.0', { main: '1.0.0' }, { vfs, cwd: '/proj', registry }),
    ).rejects.toThrow('simulated fetch failure for req@1.0.0');
  });

  it('[fault: concurrent-same-key] promotes a deferred optional-descendant fetch when a later required path dedupes', async () => {
    // a -> opt (optional) -> shared (required within that optional subtree)
    // schedules shared first with optional failure semantics. b -> shared is
    // globally required and must strengthen the already-scheduled demand.
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('a', new Map([['1.0.0', await makeEntry('a', '1.0.0', {}, { opt: '1.0.0' })]]));
    db.set('opt', new Map([['1.0.0', await makeEntry('opt', '1.0.0', { shared: '1.0.0' })]]));
    db.set('b', new Map([['1.0.0', await makeEntry('b', '1.0.0', { shared: '1.0.0' })]]));
    db.set('shared', new Map([['1.0.0', await makeEntry('shared', '1.0.0')]]));
    const registry = new CountingDelayedRegistry(db);
    registry.rejectKeys.add('shared@1.0.0');
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    await expect(
      install('root', '1.0.0', { a: '1.0.0', b: '1.0.0' }, { vfs, cwd: '/proj', registry }),
    ).rejects.toThrow('simulated fetch failure for shared@1.0.0');
  });

  it('a failed OPTIONAL-boundary fetch does not poison a later REQUIRED visit of the same name (#24 dedup-gate bug)', async () => {
    // BLOCKER #24: `scheduled` is set synchronously BEFORE the optional-boundary
    // fetch, and was NEVER cleaned when that fetch rejected (the catch only
    // warned). So a name that fails as OPTIONAL via one parent, then is REQUIRED
    // via another parent, hit `scheduled.has` → early-return → silently absent,
    // and the install reported SUCCESS. Real npm (and the old serial pinned.has
    // walk) ABORTS: `shared` is a REQUIRED dep that could not be installed.
    //
    // Order matters: `a` (optional `shared`) is visited before `b` (required
    // `shared`), so the failed-optional visit poisons `scheduled` first.
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    // a: requires shared OPTIONALLY (visited first → poisons the gate on failure)
    db.set('a', new Map([['1.0.0', await makeEntry('a', '1.0.0', {}, { shared: '1.0.0' })]]));
    // b: requires shared (and shared requires deep) — both must abort the install
    db.set('b', new Map([['1.0.0', await makeEntry('b', '1.0.0', { shared: '1.0.0' })]]));
    db.set('shared', new Map([['1.0.0', await makeEntry('shared', '1.0.0', { deep: '1.0.0' })]]));
    db.set('deep', new Map([['1.0.0', await makeEntry('deep', '1.0.0')]]));
    const registry = new CountingDelayedRegistry(db);
    registry.rejectKeys.add('shared@1.0.0'); // shared's tarball fetch fails

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    // shared is REQUIRED via b → the install MUST throw (npm parity), even though
    // it ALSO appears as a failed optional via a (visited first).
    await expect(
      install('root', '1.0.0', { a: '1.0.0', b: '1.0.0' }, { vfs, cwd: '/proj', registry }),
    ).rejects.toThrow('simulated fetch failure for shared@1.0.0');
  });
});
