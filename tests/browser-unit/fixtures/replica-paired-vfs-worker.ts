/// <reference lib="webworker" />
import { installOpfsFs } from '@riftydev/vfs/internal';

declare const self: DedicatedWorkerGlobalScope;

async function run() {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(
    crypto.randomUUID(),
    { create: true },
  );
  const { fsSync, vfs } = await installOpfsFs(root, { layout: 'replica', ioReportTimeoutMs: 30 });
  await vfs.mkdir('/tree');
  await vfs.writeFile('/tree/a', new Uint8Array([0, 255, 128, 1]));
  await vfs.utimes('/tree/a', 12000, 34000);
  const stream = await vfs.openReadable('/tree/a', { start: 1, end: 3, chunkSize: 1 });
  const streamed = [...new Uint8Array(await new Response(stream).arrayBuffer())];
  const metadata = await vfs.stat('/tree/a');

  const createWritable = FileSystemFileHandle.prototype.createWritable;
  let rejectNext = true;
  FileSystemFileHandle.prototype.createWritable = function (options) {
    if (rejectNext && this.name.startsWith('segment-')) {
      rejectNext = false;
      return Promise.reject(new DOMException('paired-write-quota', 'QuotaExceededError'));
    }
    return createWritable.call(this, options);
  };
  let failed = '';
  try {
    await vfs.writeFile('/tree/failed', 'lost-write');
  } catch (error) {
    failed = String(error);
  } finally {
    FileSystemFileHandle.prototype.createWritable = createWritable;
  }
  // A different successful native call must not inherit this unresolved ledger entry.
  await vfs.writeFile('/tree/healthy', 'saved-write');
  const dirty = (await fsSync.flush()).total;
  const absentNative = !(await vfs.exists('/tree/failed'));
  const liveFailed = fsSync.existsSync('/tree/failed');
  await vfs.writeFile('/tree/failed', 'repaired-write');
  await vfs.rm('/tree/healthy');

  let release!: () => void;
  let reached!: () => void;
  const held = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const latch = new Promise<void>((resolve) => {
    release = resolve;
  });
  let armed = true;
  FileSystemFileHandle.prototype.createWritable = async function (options) {
    const writer = await createWritable.call(this, options);
    const close = writer.close.bind(writer);
    writer.close = async () => {
      if (armed && this.name === 'HEAD') {
        armed = false;
        reached();
        await latch;
      }
      await close();
    };
    return writer;
  };
  let settled = false;
  const writing = vfs.writeFile('/tree/a', 'late-write').then(() => {
    settled = true;
  });
  await held;
  const timeoutReport = await fsSync.flush();
  const settledAtReport = settled;
  release();
  await writing;
  FileSystemFileHandle.prototype.createWritable = createWritable;
  const clean = (await fsSync.flush()).total;
  fsSync.closeAll();
  const fresh = await installOpfsFs(root, { layout: 'replica' });
  try {
    return {
      streamed,
      mtime: metadata.mtime,
      failed,
      dirty,
      absentNative,
      liveFailed,
      timeoutTotal: timeoutReport.total,
      settledAtReport,
      clean,
      entries: (await fresh.vfs.readdir('/tree')).map((entry) => entry.name),
      repaired: await fresh.vfs.readFileText('/tree/failed'),
      late: await fresh.vfs.readFileText('/tree/a'),
    };
  } finally {
    fresh.fsSync.closeAll();
  }
}
self.onmessage = () => {
  void run().then(
    (result) => self.postMessage({ result }),
    (error: unknown) => self.postMessage({ error: String(error) }),
  );
};
