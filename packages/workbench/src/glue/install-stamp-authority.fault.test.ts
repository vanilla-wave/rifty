import { OpfsFsSync } from '@riftydev/vfs';
import { resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it, vi } from 'vitest';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import { createInstallStampAuthority } from './install-stamp-authority.ts';
import { SyncMirrorVfs } from './sync-mirror-vfs.ts';

const ROOT = '/project';
const PACKAGE_JSON = '{"name":"app","dependencies":{"vite":"5.4.21"}}\n';
const PACKAGE_LOCK = '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n';
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
  fsSync.writeFileSync(`${ROOT}/package-lock.json`, new TextEncoder().encode(PACKAGE_LOCK));
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
