import { OpfsFsSync } from '@riftydev/vfs';
import { resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it, vi } from 'vitest';
import { createOwnerVfsAuthorityComposition } from '../workers/owner-vfs-authority.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import { createInstallStampAuthority } from './install-stamp-authority.ts';
import { SyncMirrorVfs } from './sync-mirror-vfs.ts';

const ROOT = '/project';
const PACKAGE_JSON = '{"name":"app","dependencies":{"vite":"5.4.21"}}\n';
const WATCHDOG_MS = 30_000;

function fakeOpfsRoot(): FileSystemDirectoryHandle {
  const root = {
    kind: 'directory',
    name: '',
    getDirectoryHandle: async () => root,
    removeEntry: async () => {},
  };
  return root as unknown as FileSystemDirectoryHandle;
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetSyncMirror();
});

it('bounds a real OPFS persist hang and loudly refuses install-stamp promotion', async () => {
  vi.useFakeTimers();
  vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
  const hung = deferred();
  let hangTreeWrite = false;
  const fsSync = new OpfsFsSync(fakeOpfsRoot(), {
    readFile: async () => new Uint8Array(),
    writeFile: (path) =>
      hangTreeWrite && path === `${ROOT}/node_modules/vite/package.json`
        ? hung.promise
        : Promise.resolve(),
    rm: async () => {},
  });
  const vfs = new SyncMirrorVfs();
  setSyncMirror(fsSync, { async: vfs });
  fsSync.mkdirSync(`${ROOT}/node_modules/vite`, { recursive: true });
  fsSync.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(PACKAGE_JSON));
  fsSync.writeFileSync(`${ROOT}/node_modules/vite/package.json`, new TextEncoder().encode('{}\n'));
  await fsSync.flush();

  const stamps = createInstallStampAuthority({ vfs, fsSync });
  const project = {
    projectId: 'app',
    root: ROOT,
    slug: 'app',
    identity: installArtifactIdentity,
  };
  const claim = await stamps.demote(project);
  await fsSync.flush();
  hangTreeWrite = true;
  fsSync.writeFileSync(
    `${ROOT}/node_modules/vite/package.json`,
    new TextEncoder().encode('{"version":"5.4.21"}\n'),
  );

  const promotion = stamps.promote(
    { ...project, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: 1, flush: () => fsSync.flush() },
  );
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(WATCHDOG_MS);

  await expect(promotion).resolves.toMatchObject({
    status: 'refused',
    reason: 'guarded-scope-not-durable',
    report: {
      total: expect.any(Number),
      failures: [
        expect.objectContaining({
          path: `${ROOT}/node_modules/vite/package.json`,
          op: 'write',
          message: expect.stringContaining('did not settle'),
        }),
      ],
    },
  });
  hung.resolve();
});

it('a trusted stamp never becomes durable while an earlier-enqueued persist op is unsettled (ADR-0358 stamp full fence)', async () => {
  // GREEN on main by FIFO: global write-through admission physically queues the
  // trusted-stamp write behind every earlier-enqueued op. ADR-0358 parallel
  // per-path lanes must preserve this via an explicit full fence in promote():
  // the wedged op is OUT of the guarded scope (proof flush reports it, refuses
  // nothing), so only the fence keeps the stamp off OPFS while it is in flight.
  vi.useFakeTimers();
  vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
  const STAMP_PATH = `${ROOT}/node_modules/.rifty-install-stamp.json`;
  const APP_TS = `${ROOT}/src/app.ts`;
  const textOf = new TextDecoder();
  const wedge = deferred();
  const stampDurable = deferred();
  const completed: Array<{ readonly path: string; readonly text: string }> = [];
  const trustedStampWrites = () =>
    completed.filter(
      (write) => write.path === STAMP_PATH && !write.text.includes('"durability": "pending"'),
    );
  const fsSync = new OpfsFsSync(fakeOpfsRoot(), {
    readFile: async () => new Uint8Array(),
    writeFile: async (path, data) => {
      if (path === APP_TS) await wedge.promise;
      const text = textOf.decode(data);
      completed.push({ path, text });
      if (path === STAMP_PATH && !text.includes('"durability": "pending"')) stampDurable.resolve();
    },
    rm: async () => {},
  });
  const vfs = new SyncMirrorVfs();
  setSyncMirror(fsSync, { async: vfs });
  fsSync.mkdirSync(`${ROOT}/node_modules/vite`, { recursive: true });
  fsSync.mkdirSync(`${ROOT}/src`, { recursive: true });
  fsSync.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(PACKAGE_JSON));
  fsSync.writeFileSync(`${ROOT}/node_modules/vite/package.json`, new TextEncoder().encode('{}\n'));
  await fsSync.flush();

  const stamps = createInstallStampAuthority({ vfs, fsSync });
  const project = {
    projectId: 'app',
    root: ROOT,
    slug: 'app',
    identity: installArtifactIdentity,
  };
  const claim = await stamps.demote(project);
  await fsSync.flush();

  // Wedge: unresolved persist op enqueued BEFORE the trusted-stamp write, on a
  // path outside node_modules and off the claim path.
  fsSync.writeFileSync(APP_TS, new TextEncoder().encode('export {};\n'));

  const promotion = stamps.promote(
    { ...project, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: 1, flush: () => fsSync.flush() },
  );
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(WATCHDOG_MS);

  // Watchdog released the bounded proof, yet the wedged op is still physically
  // in flight: the trusted stamp must NOT have completed at the OPFS surface.
  expect(completed.map((write) => write.path)).not.toContain(APP_TS);
  expect(trustedStampWrites()).toHaveLength(0);

  wedge.resolve();
  await stampDurable.promise;
  await expect(promotion).resolves.toMatchObject({
    status: 'trusted',
    stamp: expect.objectContaining({ slug: 'app', packages: 1 }),
  });
  const report = await fsSync.flush();
  expect(report.total).toBe(0);
  expect(trustedStampWrites()).toHaveLength(1);
});

it('the stamp full fence holds through the production claimIo composition — a trusted stamp write via installStampClaims never becomes durable while an earlier-enqueued persist op is unsettled (ADR-0358)', async () => {
  // ADR-0358 stamp full fence, sibling sweep over BOTH writeRawStampSync
  // branches: the previous pin fences the raw-fsSync writer; this pin fences
  // the claimIo writer through the PRODUCTION composition (workbench-owner
  // runtime: createOwnerVfsAuthorityComposition → owner-package-state wires
  // createInstallStampAuthority({ vfs, fsSync: authority, claimIo:
  // installStampClaims })). The claim write reaches the SAME OPFS write-through
  // FIFO via #writeInstallStampClaim → fs.writeFileSync, so the fence
  // obligation is identical: the trusted stamp must stay off OPFS while an
  // earlier-enqueued op is physically in flight.
  vi.useFakeTimers();
  vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
  const STAMP_PATH = `${ROOT}/node_modules/.rifty-install-stamp.json`;
  const APP_TS = `${ROOT}/src/app.ts`;
  const textOf = new TextDecoder();
  const wedge = deferred();
  const stampDurable = deferred();
  const completed: Array<{ readonly path: string; readonly text: string }> = [];
  const trustedStampWrites = () =>
    completed.filter(
      (write) => write.path === STAMP_PATH && !write.text.includes('"durability": "pending"'),
    );
  const fsSync = new OpfsFsSync(fakeOpfsRoot(), {
    readFile: async () => new Uint8Array(),
    writeFile: async (path, data) => {
      if (path === APP_TS) await wedge.promise;
      const text = textOf.decode(data);
      completed.push({ path, text });
      if (path === STAMP_PATH && !text.includes('"durability": "pending"')) stampDurable.resolve();
    },
    rm: async () => {},
  });
  // Production shape (workbench-owner-runtime.ts): composition over the raw
  // sync mirror, then the authority becomes the sole owner-realm FsSync.
  const composition = createOwnerVfsAuthorityComposition(fsSync, {
    initialRoots: ['/', '/.rifty'],
  });
  const { authority, installStampClaims } = composition;
  const vfs = new SyncMirrorVfs();
  setSyncMirror(authority, { async: vfs });
  authority.mkdirSync(`${ROOT}/node_modules/vite`, { recursive: true });
  authority.mkdirSync(`${ROOT}/src`, { recursive: true });
  authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(PACKAGE_JSON));
  authority.writeFileSync(
    `${ROOT}/node_modules/vite/package.json`,
    new TextEncoder().encode('{}\n'),
  );
  await authority.flush();

  // EXACT production triple (owner-package-state.ts createOwnerPackageState).
  const stamps = createInstallStampAuthority({
    vfs,
    fsSync: authority,
    claimIo: installStampClaims,
  });
  const project = {
    projectId: 'app',
    root: ROOT,
    slug: 'app',
    identity: installArtifactIdentity,
  };
  const claim = await stamps.demote(project);
  await authority.flush();

  // Wedge: unresolved persist op enqueued BEFORE the trusted-stamp claim
  // write, outside the guarded scope and off the claim path.
  authority.writeFileSync(APP_TS, new TextEncoder().encode('export {};\n'));

  const promotion = stamps.promote(
    { ...project, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: 1, flush: () => authority.flush() },
  );
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(WATCHDOG_MS);

  // Watchdog released the bounded proof, yet the wedged op is still physically
  // in flight: the trusted stamp routed through installStampClaims must NOT
  // have completed at the OPFS surface.
  expect(completed.map((write) => write.path)).not.toContain(APP_TS);
  expect(trustedStampWrites()).toHaveLength(0);

  wedge.resolve();
  await stampDurable.promise;
  await expect(promotion).resolves.toMatchObject({
    status: 'trusted',
    stamp: expect.objectContaining({ slug: 'app', packages: 1 }),
  });
  const report = await authority.flush();
  expect(report?.total).toBe(0);
  expect(trustedStampWrites()).toHaveLength(1);
});

// ————— ADR-0358 stamp-full-fence carrier families, swept over BOTH stamp
// writers: 'raw-fsSync' (first fence pin's wiring) and 'claimIo-composition'
// (production owner-runtime triple, second fence pin's wiring). —————

const utf8 = new TextEncoder();
const PROJECT = {
  projectId: 'app',
  root: ROOT,
  slug: 'app',
  identity: installArtifactIdentity,
};

type StampWriterWiring = 'raw-fsSync' | 'claimIo-composition';
const STAMP_WRITER_WIRINGS: readonly StampWriterWiring[] = ['raw-fsSync', 'claimIo-composition'];

/** One writeRawStampSync branch over an injected OPFS backend writeFile. */
function wireStampWriter(
  wiring: StampWriterWiring,
  writeFile: (path: string, data: Uint8Array) => Promise<void>,
) {
  const fsSync = new OpfsFsSync(fakeOpfsRoot(), {
    readFile: async () => new Uint8Array(),
    writeFile,
    rm: async () => {},
  });
  const vfs = new SyncMirrorVfs();
  if (wiring === 'raw-fsSync') {
    setSyncMirror(fsSync, { async: vfs });
    return { fs: fsSync, stamps: createInstallStampAuthority({ vfs, fsSync }) };
  }
  // Production shape (workbench-owner-runtime.ts → owner-package-state.ts).
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(fsSync, {
    initialRoots: ['/', '/.rifty'],
  });
  setSyncMirror(authority, { async: vfs });
  return {
    fs: authority,
    stamps: createInstallStampAuthority({ vfs, fsSync: authority, claimIo: installStampClaims }),
  };
}

/** Same seeded-project + demoted-claim preamble the existing fence pins use. */
async function wireInstalledProject(
  wiring: StampWriterWiring,
  writeFile: (path: string, data: Uint8Array) => Promise<void>,
) {
  const { fs, stamps } = wireStampWriter(wiring, writeFile);
  fs.mkdirSync(`${ROOT}/node_modules/vite`, { recursive: true });
  fs.mkdirSync(`${ROOT}/src`, { recursive: true });
  fs.writeFileSync(`${ROOT}/package.json`, utf8.encode(PACKAGE_JSON));
  fs.writeFileSync(`${ROOT}/node_modules/vite/package.json`, utf8.encode('{}\n'));
  await fs.flush();
  const claim = await stamps.demote(PROJECT);
  await fs.flush();
  return { fs, stamps, claim };
}

for (const wiring of STAMP_WRITER_WIRINGS) {
  it(`an op enqueued after the durability proof but before publication still fences the trusted stamp — ${wiring} writer (ADR-0358 stamp full fence)`, async () => {
    // ADR-0358 full fence, post-proof window: both earlier fence pins wedge
    // BEFORE the proof flush, so a fence frozen to the proof-flush watermark
    // passes them while letting the stamp overtake THIS op — enqueued the
    // instant the proof resolves, before promote()'s conclusion slot writes
    // the stamp (promote awaits nothing else in that window: only the idle
    // per-root queue and sync-backed reads). Kills the "fence = ops enqueued
    // up to the proof watermark" mutant. GREEN on main by FIFO admission.
    vi.useFakeTimers();
    vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
    const STAMP_PATH = `${ROOT}/node_modules/.rifty-install-stamp.json`;
    const LATE_TS = `${ROOT}/src/late.ts`;
    const textOf = new TextDecoder();
    const wedge = deferred();
    const stampDurable = deferred();
    const completed: Array<{ readonly path: string; readonly text: string }> = [];
    const trustedStampWrites = () =>
      completed.filter(
        (write) => write.path === STAMP_PATH && !write.text.includes('"durability": "pending"'),
      );
    const { fs, stamps, claim } = await wireInstalledProject(wiring, async (path, data) => {
      if (path === LATE_TS) await wedge.promise;
      const text = textOf.decode(data);
      completed.push({ path, text });
      if (path === STAMP_PATH && !text.includes('"durability": "pending"')) stampDurable.resolve();
    });

    const promotion = stamps.promote(
      { ...PROJECT, packageJsonText: PACKAGE_JSON },
      {
        epoch: claim.epoch,
        packages: 1,
        // Post-proof wedge: held op enqueued AFTER the proof flush resolved,
        // BEFORE promote proceeds to the conclusion-slot stamp write.
        flush: async () => {
          const report = await fs.flush();
          fs.writeFileSync(LATE_TS, utf8.encode('export {};\n'));
          return report;
        },
      },
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);

    // The post-watermark op is still physically in flight: no trusted-stamp
    // write may have completed at the OPFS surface.
    expect(completed.map((write) => write.path)).not.toContain(LATE_TS);
    expect(trustedStampWrites()).toHaveLength(0);

    wedge.resolve();
    await stampDurable.promise;
    await expect(promotion).resolves.toMatchObject({
      status: 'trusted',
      stamp: expect.objectContaining({ slug: 'app', packages: 1 }),
    });
    const report = await fs.flush();
    expect(report?.total).toBe(0);
    expect(trustedStampWrites()).toHaveLength(1);
  });
}

for (const wiring of STAMP_WRITER_WIRINGS) {
  it(`a settled out-of-scope persist failure stays ledgered while promotion trusts — ${wiring} writer (ADR-0358 stamp full fence)`, async () => {
    // ADR-0358 fences ORDER, not global cleanliness: both earlier fence pins
    // END with a clean ledger, so an implementation equating the fence with
    // "global ledger clean before stamp" passes them. Here a foreign op —
    // outside the guarded scope, off the claim path — rejects and SETTLES
    // before promote: promotion must trust (guardedScopeFailed/claimFailed
    // ignore it) and must neither heal nor require healing of that entry.
    // Kills the "fence = refuse/heal until report.total === 0" mutant.
    vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
    const BROKEN_TS = `${ROOT}/src/broken.ts`;
    const { fs, stamps, claim } = await wireInstalledProject(wiring, async (path) => {
      if (path === BROKEN_TS) throw new Error('EDQUOT: opfs quota exhausted');
    });

    // Foreign failure: rejects immediately → recorded in the persist ledger.
    fs.writeFileSync(BROKEN_TS, utf8.encode('export {};\n'));

    await expect(
      stamps.promote(
        { ...PROJECT, packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1, flush: () => fs.flush() },
      ),
    ).resolves.toMatchObject({
      status: 'trusted',
      stamp: expect.objectContaining({ slug: 'app', packages: 1 }),
    });

    // The foreign entry is STILL ledgered after trust: exactly the broken path.
    const report = await fs.flush();
    expect(report).toMatchObject({
      total: 1,
      failures: [expect.objectContaining({ path: BROKEN_TS, op: 'write' })],
    });
  });
}

// One MORE held op than ADR-0358's ~16-lane admission cap: under any bounded
// scheduler at least one of them is CAP-QUEUED (unadmitted), not in a lane.
const SATURATION_OPS = 17;
const heldPath = (n: number) => `${ROOT}/src/held-${String(n).padStart(2, '0')}.ts`;

for (const wiring of STAMP_WRITER_WIRINGS) {
  it(`a saturated post-proof backlog still fences the trusted stamp: publication waits for cap-QUEUED work, not just admitted lanes — ${wiring} writer (ADR-0358 stamp full fence)`, async () => {
    // ADR-0358 full fence over a SATURATED backlog: the post-proof pin above
    // holds ONE wedge, so a fence that waits only for ADMITTED lanes (a
    // snapshot of active ops) passes it while a 17th op sits CAP-QUEUED
    // unadmitted — trusted publication over earlier cap-queued work. Here the
    // flush seam enqueues 17 held writes on DISTINCT paths (one more than the
    // ~16-lane cap), so when the stamp fence is taken at most 16 are admitted
    // and at least one — the last-enqueued — is cap-queued. Release 16 and
    // drain: a naive admitted-lanes-only fence has nothing left in its
    // snapshot and publishes — it fails at the 17th-held assert below. GREEN
    // on main by FIFO: the stamp write physically queues behind all 17.
    vi.useFakeTimers();
    vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
    const STAMP_PATH = `${ROOT}/node_modules/.rifty-install-stamp.json`;
    const heldPaths = Array.from({ length: SATURATION_OPS }, (_, index) => heldPath(index + 1));
    const lastHeld = heldPath(SATURATION_OPS);
    const gates = new Map(heldPaths.map((path) => [path, deferred()]));
    const textOf = new TextDecoder();
    const stampDurable = deferred();
    const completed: Array<{ readonly path: string; readonly text: string }> = [];
    const completedPaths = () => completed.map((write) => write.path);
    const trustedStampWrites = () =>
      completed.filter(
        (write) => write.path === STAMP_PATH && !write.text.includes('"durability": "pending"'),
      );
    // Chain drain WITHOUT reaching another watchdog deadline: a 1ms virtual
    // tick (real event-loop yield under fake timers) plus enough microtask
    // hops for each released op's continuation chain to settle.
    const drainReleased = async () => {
      await vi.advanceTimersByTimeAsync(1);
      for (let hop = 0; hop < 64; hop += 1) await Promise.resolve();
    };
    const { fs, stamps, claim } = await wireInstalledProject(wiring, async (path, data) => {
      await gates.get(path)?.promise;
      const text = textOf.decode(data);
      completed.push({ path, text });
      if (path === STAMP_PATH && !text.includes('"durability": "pending"')) stampDurable.resolve();
    });

    const promotion = stamps.promote(
      { ...PROJECT, packageJsonText: PACKAGE_JSON },
      {
        epoch: claim.epoch,
        packages: 1,
        // Saturating post-proof backlog: 17 held out-of-guarded-scope writes
        // enqueued AFTER the proof flush resolved, BEFORE promote proceeds to
        // the conclusion-slot stamp write.
        flush: async () => {
          const report = await fs.flush();
          for (const path of heldPaths) fs.writeFileSync(path, utf8.encode('export {};\n'));
          return report;
        },
      },
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);

    // All 17 unsettled (in flight or unadmitted): no trusted-stamp write may
    // have completed at the OPFS surface.
    expect(completedPaths().filter((path) => gates.has(path))).toEqual([]);
    expect(trustedStampWrites()).toHaveLength(0);

    // Incremental release, one held op per step; the last-enqueued 17th stays
    // held. While ANY backlog op is unsettled the stamp must stay off OPFS.
    for (const path of heldPaths.slice(0, -1)) {
      gates.get(path)?.resolve();
      await drainReleased();
      expect(trustedStampWrites()).toHaveLength(0);
    }
    // 16 of 17 settled as success; ONLY the cap-queued 17th is outstanding.
    for (const path of heldPaths.slice(0, -1)) expect(completedPaths()).toContain(path);
    expect(completedPaths()).not.toContain(lastHeld);
    // THE discriminating assert: every op an admitted-lanes-only fence
    // snapshotted has settled, so the naive fence publishes the trusted stamp
    // right here — over the still-held 17th. The full fence must not.
    expect(trustedStampWrites()).toHaveLength(0);

    // Release the last → drain → the stamp becomes durable, promotion trusts,
    // and every ledger entry (watchdog noise included) heals on the
    // successful settles: final ledger 0.
    gates.get(lastHeld)?.resolve();
    await stampDurable.promise;
    await expect(promotion).resolves.toMatchObject({
      status: 'trusted',
      stamp: expect.objectContaining({ slug: 'app', packages: 1 }),
    });
    expect(completedPaths()).toEqual(expect.arrayContaining(heldPaths));
    const report = await fs.flush();
    expect(report?.total).toBe(0);
    expect(trustedStampWrites()).toHaveLength(1);
  });
}
