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
