/// <reference lib="webworker" />
import { NotImplementedError } from '@riftydev/vfs';
import { installOpfsFs } from '@riftydev/vfs/internal';
import { settleOpfsSetup } from './opfs-setup.ts';

declare const self: DedicatedWorkerGlobalScope;
interface Input {
  readonly mode: 'files' | 'replica';
  readonly kind: 'concurrent' | 'read' | 'stat' | 'dir' | 'content' | 'controls' | 'close';
}
async function run(input: Input) {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(
    crypto.randomUUID(),
    { create: true },
  );
  const pair =
    input.mode === 'replica'
      ? await installOpfsFs(root, { layout: 'replica', ioReportTimeoutMs: 50 })
      : await installOpfsFs(root, { ioReportTimeoutMs: 50 });
  const fs = pair.fsSync;
  fs.mkdirSync('/dir');
  fs.writeFileSync('/dir/a', new TextEncoder().encode('stable'));
  await settleOpfsSetup(fs);
  try {
    if (input.kind === 'controls') {
      const errors: { method: string; name: string; feature: string }[] = [];
      for (const [method, call] of [
        ['preloadContent', () => fs.preloadContent()],
        ['refreshIndex', () => fs.refreshIndex()],
        [
          'openSync',
          () => fs.openSync(input.mode === 'replica' ? '/unsupported-created' : '/dir/a', true),
        ],
      ] as const) {
        try {
          await call();
        } catch (error) {
          errors.push({
            method,
            name: error instanceof Error ? error.name : '',
            feature: error instanceof NotImplementedError ? error.feature : '',
          });
        }
      }
      return {
        errors,
        created:
          fs.existsSync('/unsupported-created') || (await pair.vfs.exists('/unsupported-created')),
        content: await pair.vfs.readFileText('/dir/a'),
      };
    }
    if (input.kind === 'concurrent') {
      let done = false;
      let reads = 0;
      const errors: string[] = [];
      const read = async () => {
        while (!done) {
          try {
            const [text, stat, entries] = await Promise.all([
              pair.vfs.readFileText('/dir/a'),
              pair.vfs.stat('/dir/a'),
              pair.vfs.readdir('/dir'),
            ]);
            if (
              text !== 'stable' ||
              !stat.isFile ||
              stat.size !== 6 ||
              entries.length !== 1 ||
              entries[0]?.name !== 'a'
            )
              throw new Error('native read changed a stable entry');
            reads++;
          } catch (error) {
            errors.push(String(error));
          }
        }
      };
      const reader = read();
      for (let i = 0; i < 140; i++) {
        fs.writeFileSync('/b', new TextEncoder().encode(String(i)));
        await settleOpfsSetup(fs);
      }
      done = true;
      await reader;
      return { reads, errors };
    }
    for (let i = 0; i < 63; i++) {
      fs.writeFileSync('/b', new TextEncoder().encode(String(i)));
      await settleOpfsSetup(fs);
    }
    const directory = await root.getDirectoryHandle('.rifty-replica-v1');
    const head = JSON.parse(
      await (await (await directory.getFileHandle('HEAD')).getFile()).text(),
    ) as { segments: string[] };
    if (head.segments.length !== 64) throw new Error('compaction boundary was not reached');
    const oldName = `segment-${head.segments[0]}.bin`;
    const getHandle = FileSystemDirectoryHandle.prototype.getFileHandle;
    const remove = FileSystemDirectoryHandle.prototype.removeEntry;
    const slice = Blob.prototype.slice;
    const arrayBuffer = Blob.prototype.arrayBuffer;
    const contentSlices = new WeakSet<Blob>();
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let armed = true;
    let released = false;
    let reclaimedEarly = false;
    const pause = async () => {
      armed = false;
      reached();
      await held;
    };
    FileSystemDirectoryHandle.prototype.getFileHandle = async function (name, options) {
      const handle = await getHandle.call(this, name, options);
      if (armed && input.kind !== 'content' && name === oldName) await pause();
      return handle;
    };
    Blob.prototype.slice = function (start, end, contentType) {
      const result = slice.call(this, start, end, contentType);
      if (this instanceof File && this.name === oldName && (end ?? 0) - (start ?? 0) === 6)
        contentSlices.add(result);
      return result;
    };
    Blob.prototype.arrayBuffer = async function () {
      if (armed && input.kind === 'content' && contentSlices.has(this)) await pause();
      return arrayBuffer.call(this);
    };
    FileSystemDirectoryHandle.prototype.removeEntry = async function (name, options) {
      if (name === oldName && !released) reclaimedEarly = true;
      return remove.call(this, name, options);
    };
    try {
      const reading = (
        input.kind === 'dir'
          ? pair.vfs.readdir('/dir')
          : input.kind === 'stat'
            ? pair.vfs.stat('/dir/a')
            : pair.vfs.readFileText('/dir/a')
      ).then(
        (value) => ({ ok: true, value }),
        (error: unknown) => ({ ok: false, error: String(error) }),
      );
      await blocked;
      if (input.kind === 'close') {
        fs.closeAll();
        let acquiredBeforeRead = false;
        try {
          const competing = await installOpfsFs(root, { layout: 'replica', ioReportTimeoutMs: 40 });
          acquiredBeforeRead = true;
          competing.fsSync.closeAll();
        } catch {
          /* Native guard must still be owned by the admitted reader. */
        }
        released = true;
        release();
        const read = await reading;
        const fresh = await installOpfsFs(root, { layout: 'replica', ioReportTimeoutMs: 100 });
        fresh.fsSync.closeAll();
        return { acquiredBeforeRead, read, reacquired: true };
      }
      fs.writeFileSync('/b', new TextEncoder().encode('compacted'));
      const reported = await fs.flush();
      released = true;
      release();
      const read = await reading;
      await fs.fence();
      const clean = await fs.flush();
      let oldRemoved = false;
      try {
        await getHandle.call(directory, oldName);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') oldRemoved = true;
        else throw error;
      }
      return { read, reclaimedEarly, reported: reported.total, clean: clean.total, oldRemoved };
    } finally {
      release();
      FileSystemDirectoryHandle.prototype.getFileHandle = getHandle;
      FileSystemDirectoryHandle.prototype.removeEntry = remove;
      Blob.prototype.slice = slice;
      Blob.prototype.arrayBuffer = arrayBuffer;
    }
  } finally {
    fs.closeAll();
  }
}
self.onmessage = ({ data }: MessageEvent<Input>) => {
  void run(data).then(
    (result) => self.postMessage({ result }),
    (error: unknown) => self.postMessage({ error: String(error) }),
  );
};
