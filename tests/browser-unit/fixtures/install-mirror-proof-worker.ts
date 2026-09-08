/// <reference lib="webworker" />
import { OpfsFsSync, asyncVfs, initBackend } from '../../../packages/vfs/src/index.ts';
import { syncMirror } from '../../../packages/vfs/src/index.ts';
import { InstallMirrorVfs } from '../../../packages/workbench/src/glue/install-mirror-vfs.ts';
import { SyncMirrorVfs } from '../../../packages/workbench/src/glue/sync-mirror-vfs.ts';

declare const self: DedicatedWorkerGlobalScope;
const bytes = (value: string) => new TextEncoder().encode(value);

self.onmessage = () => {
  void run().then(
    (result) => self.postMessage({ result }),
    (error) => self.postMessage({ error: String(error) }),
  );
};
async function run() {
  await initBackend();
  const raw = syncMirror();
  if (!(raw instanceof OpfsFsSync)) throw new Error('real OPFS required');
  const native = asyncVfs();
  const install = new InstallMirrorVfs(raw, native);
  const generic = new SyncMirrorVfs();
  raw.mkdirSync('/proof', { recursive: true });
  raw.writeFileSync('/proof/file', bytes('same'));
  raw.writeFileSync('/proof/empty', bytes(''));
  await raw.flush();
  let writes = 0;
  let quota = false;
  let release: (() => void) | undefined;
  let hold = false;
  const nativeWrite = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = async function (...args) {
    writes++;
    if (quota) throw new DOMException('proof quota', 'QuotaExceededError');
    if (hold) {
      hold = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return Reflect.apply(nativeWrite, this, args);
  };
  await install.writeFile('/proof/file', 'same');
  await raw.flush();
  const cleanWrites = writes;
  await generic.writeFile('/proof/file', 'same');
  await raw.flush();
  const genericWrites = writes - cleanWrites;
  writes = 0;
  await install.writeFile('/proof/empty', '');
  await raw.flush();
  const emptyWrites = writes;
  // Mutating a returned cache buffer does not persist it.
  raw.readFileBytesSync('/proof/file').set(bytes('edit'));
  await install.writeFile('/proof/file', 'edit');
  await raw.flush();
  const alias = await native.readFileText('/proof/file');
  quota = true;
  raw.writeFileSync('/proof/file', bytes('heal'));
  const failed = await raw.flush();
  quota = false;
  await install.writeFile('/proof/file', 'heal');
  const healed = await raw.flush();
  const dirtyBytes = await native.readFileText('/proof/file');
  let mkdirQuota = true;
  const nativeMkdir = FileSystemDirectoryHandle.prototype.getDirectoryHandle;
  FileSystemDirectoryHandle.prototype.getDirectoryHandle = function (...args) {
    if (mkdirQuota && args[0] === 'proof' && args[1]?.create)
      return Promise.reject(new DOMException('mkdir quota', 'QuotaExceededError'));
    return Reflect.apply(nativeMkdir, this, args);
  };
  raw.mkdirSync('/proof', { recursive: true });
  const directoryFailed = await raw.flush();
  mkdirQuota = false;
  await install.mkdir('/proof', { recursive: true });
  const directoryHealed = await raw.flush();
  // Refresh can restore disk bytes into cache while an earlier write remains pending.
  hold = true;
  raw.writeFileSync('/proof/file', bytes('late'));
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  await raw.preloadContent();
  await install.writeFile('/proof/file', 'heal');
  release();
  await raw.flush();
  const pending = await native.readFileText('/proof/file');
  let injectAfterRead = true;
  const nativeGetFile = FileSystemFileHandle.prototype.getFile;
  FileSystemFileHandle.prototype.getFile = async function (...args) {
    const file = await Reflect.apply(nativeGetFile, this, args);
    if (injectAfterRead && this.name === 'file') {
      injectAfterRead = false;
      hold = true;
      release = undefined;
      raw.writeFileSync('/proof/file', bytes('late'));
      await raw.preloadContent();
    }
    return file;
  };
  await install.writeFile('/proof/file', 'heal');
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await raw.flush();
  const duringRead = await native.readFileText('/proof/file');

  return {
    cleanWrites,
    genericWrites,
    emptyWrites,
    alias,
    failed: failed.total,
    healed: healed.total,
    dirtyBytes,
    pending,
    duringRead,
    directoryFailed: directoryFailed.total,
    directoryHealed: directoryHealed.total,
  };
}
