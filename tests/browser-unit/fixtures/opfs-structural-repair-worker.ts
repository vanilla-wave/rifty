/// <reference lib="webworker" />
import { installOpfsFs } from '@riftydev/vfs/internal';

declare const self: DedicatedWorkerGlobalScope;
interface Input {
  readonly layout: 'files' | 'replica';
  readonly scenario: 'rm' | 'rm-mkdir-fails' | 'rename' | 'late-rm';
}
async function run(input: Input) {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(
    crypto.randomUUID(),
    { create: true },
  );
  const open = () =>
    input.layout === 'replica'
      ? installOpfsFs(root, { layout: 'replica', ioReportTimeoutMs: 50 })
      : installOpfsFs(root, { ioReportTimeoutMs: 50 });
  const pair = await open();
  const fs = pair.fsSync;
  const bytes = (text: string) => new TextEncoder().encode(text);
  fs.mkdirSync('/a');
  fs.writeFileSync('/a/old', bytes('old'));
  if ((await fs.flush()).total) throw new Error('seed failed');
  const remove = FileSystemDirectoryHandle.prototype.removeEntry;
  const directory = FileSystemDirectoryHandle.prototype.getDirectoryHandle;
  const writable = FileSystemFileHandle.prototype.createWritable;
  let phase: 'remove' | 'mkdir' | 'off' = 'remove';
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fail = () => new DOMException('structural-quota', 'QuotaExceededError');
  FileSystemDirectoryHandle.prototype.removeEntry = async function (name, options) {
    if (input.layout === 'files' && phase === 'remove' && name === 'a') {
      if (input.scenario === 'late-rm') await held;
      else throw fail();
    }
    return remove.call(this, name, options);
  };
  FileSystemDirectoryHandle.prototype.getDirectoryHandle = function (name, options) {
    if (input.layout === 'files' && phase === 'mkdir' && name === 'a' && options?.create)
      return Promise.reject(fail());
    return directory.call(this, name, options);
  };
  FileSystemFileHandle.prototype.createWritable = async function (options) {
    if (input.layout === 'replica' && phase !== 'off' && this.name.startsWith('segment-')) {
      if (input.scenario !== 'late-rm' || phase === 'mkdir') throw fail();
      const stream = await writable.call(this, options);
      const close = stream.close.bind(stream);
      stream.close = async () => {
        await held;
        await close();
      };
      return stream;
    }
    return writable.call(this, options);
  };
  try {
    if (input.scenario === 'rename') fs.renameSync('/a', '/b');
    else fs.rmSync('/a', { recursive: true });
    const failed = await fs.flush();
    phase = input.scenario === 'rm-mkdir-fails' ? 'mkdir' : 'off';
    fs.mkdirSync('/a');
    if (phase === 'mkdir') {
      if ((await fs.flush()).total === 0) throw new Error('mkdir quota did not fire');
      phase = 'off';
    }
    fs.writeFileSync('/a/new', bytes('new'));
    const afterEntry = await fs.flush();
    const stillUnproven = afterEntry.anyFailure?.((path) => path === '/a') ?? false;
    release();
    await fs.fence();
    const afterLate = await fs.flush();
    // Explicit whole-subtree replacement is a genuine repair; a directory image was not one.
    for (const path of input.scenario === 'rename' ? ['/a', '/b'] : ['/a']) {
      fs.rmSync(path, { recursive: true });
      fs.mkdirSync(path);
      fs.writeFileSync(
        `${path}/${path === '/a' ? 'new' : 'old'}`,
        bytes(path === '/a' ? 'new' : 'old'),
      );
    }
    const repaired = await fs.flush();
    const live = fs.readdirSync('/a').map((entry) => entry.name);
    const native = (await pair.vfs.readdir('/a')).map((entry) => entry.name);
    fs.closeAll();
    const fresh = await open();
    try {
      return {
        failed: failed.total,
        stillUnproven,
        afterLate: afterLate.total,
        repaired: repaired.total,
        live,
        native,
        reopened: fresh.fsSync.readdirSync('/a').map((entry) => entry.name),
      };
    } finally {
      fresh.fsSync.closeAll();
    }
  } finally {
    release();
    FileSystemDirectoryHandle.prototype.removeEntry = remove;
    FileSystemDirectoryHandle.prototype.getDirectoryHandle = directory;
    FileSystemFileHandle.prototype.createWritable = writable;
    fs.closeAll();
  }
}
self.onmessage = ({ data }: MessageEvent<Input>) => {
  void run(data).then(
    (result) => self.postMessage({ result }),
    (error: unknown) => self.postMessage({ error: String(error) }),
  );
};
