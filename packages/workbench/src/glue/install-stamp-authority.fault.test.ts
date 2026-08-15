import { OpfsFsSync } from '@riftydev/vfs';
import { resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it, vi } from 'vitest';
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
