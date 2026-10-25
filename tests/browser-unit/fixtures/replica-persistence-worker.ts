/// <reference lib="webworker" />
import { OpfsFsSync, type PersistFailureReport, initBackend, syncMirror } from '@riftydev/vfs';
import { installOpfsFs } from '@riftydev/vfs/internal';
import { installWorkbenchOwnerStorageAuthority } from '../../../packages/workbench/src/workers/workbench-owner-storage.ts';
import { settleOpfsSetup } from './opfs-setup.ts';
import manifest from './tracker-tree-manifest.json';

declare const self: DedicatedWorkerGlobalScope;
interface Input {
  namespace: string;
  kind:
    | 'spin'
    | 'roundtrip'
    | 'quota'
    | 'hold'
    | 'contend'
    | 'crash'
    | 'verify'
    | 'release'
    | 'close'
    | 'ping'
    | 'scale-write'
    | 'scale-read'
    | 'scale-mutate'
    | 'corrupt-during-append'
    | 'corrupt'
    | 'native-read-error'
    | 'compaction-quota'
    | 'configured'
    | 'legacy'
    | 'owner'
    | 'owner-contend';
  policy?: 'required' | 'preferred';
  mutated?: boolean;
  damage?: 'head' | 'segment' | 'truncate' | 'live-native';
  phase?: 'before-open' | 'before-close' | 'after-close';
  firstCommit?: boolean;
  slowSeed?: boolean;
  rounds?: number;
}
const encoder = new TextEncoder();
let fs: OpfsFsSync | undefined;
let release: (() => void) | undefined;
const report = (r: PersistFailureReport) => ({
  total: r.total,
  failures: r.failures,
  lastPathFailed: r.anyFailure?.((p) => p === '/tree/file-229'),
  otherPathFailed: r.anyFailure?.((p) => p === '/unrelated'),
});
const snapshot = (fs: OpfsFsSync) => {
  const out: { path: string; kind: string; content?: number[]; mtime?: number }[] = [];
  const visit = (path: string) => {
    const stat = fs.statSync(path);
    out.push({
      path,
      kind: stat.isFile ? 'file' : 'dir',
      mtime: stat.mtime,
      ...(stat.isFile ? { content: [...fs.readFileBytesSync(path)] } : {}),
    });
    if (stat.isDirectory)
      for (const child of fs.readdirSync(path))
        visit(path === '/' ? `/${child.name}` : `${path}/${child.name}`);
  };
  visit('/');
  return out;
};
async function open(namespace: string, timeoutMs = 30000) {
  const origin = await navigator.storage.getDirectory();
  const root = await origin.getDirectoryHandle(namespace, { create: true });
  // Baseline ignores the candidate layout; RED runs its real per-file writer.
  const install = installOpfsFs as (
    root: FileSystemDirectoryHandle,
    options: {
      layout: 'replica';
      ioReportTimeoutMs: number;
    },
  ) => ReturnType<typeof installOpfsFs>;
  const pair = await install(root, { layout: 'replica', ioReportTimeoutMs: timeoutMs });
  fs = pair.fsSync;
  return { root, ...pair };
}
function faultNative(
  action: (
    name: string,
    phase: 'before-open' | 'write' | 'before-close' | 'after-close',
    data?: FileSystemWriteChunkType,
  ) => Promise<void>,
) {
  const proto = FileSystemFileHandle.prototype;
  const create = proto.createWritable;
  proto.createWritable = async function (options) {
    await action(this.name, 'before-open');
    const stream = await create.call(this, options);
    const name = this.name;
    const write = stream.write.bind(stream);
    const close = stream.close.bind(stream);
    stream.write = async (data) => {
      await action(name, 'write', data);
      await write(data);
    };
    stream.close = async () => {
      await action(name, 'before-close');
      await close();
      await action(name, 'after-close');
    };
    return stream;
  };
  return () => {
    proto.createWritable = create;
  };
}
async function seed(instance: OpfsFsSync) {
  instance.mkdirSync('/tree', { recursive: true });
  instance.writeFileSync('/tree/a.txt', encoder.encode('old-a'));
  instance.writeFileSync('/tree/b.txt', encoder.encode('old-b'));
  await settleOpfsSetup(instance);
}
async function referencedSegments(root: FileSystemDirectoryHandle): Promise<number | null> {
  try {
    const directory = await root.getDirectoryHandle('.rifty-replica-v1');
    const text = await (await (await directory.getFileHandle('HEAD')).getFile()).text();
    if (text.length === 0) return null;
    const head = JSON.parse(text) as { segments: unknown[] };
    return head.segments.length;
  } catch (error) {
    if ((error as { name?: string }).name === 'NotFoundError') return null;
    throw error;
  }
}
function writeSize(value: FileSystemWriteChunkType | undefined): number {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof Blob) return value.size;
  if (typeof value === 'string') return encoder.encode(value).length;
  return value?.type === 'write' && value.data !== undefined && value.data !== null
    ? writeSize(value.data)
    : 0;
}
async function run(input: Input) {
  if (input.kind === 'ping') return { ready: true };
  if (input.kind === 'owner-contend') {
    try {
      const authority = await installWorkbenchOwnerStorageAuthority('preferred', {
        namespace: input.namespace,
      });
      return { acquired: true, backend: authority.snapshot.backend };
    } catch (error) {
      return { acquired: false, error: String(error) };
    }
  }
  if (input.kind === 'owner') {
    const authority = await installWorkbenchOwnerStorageAuthority(input.policy ?? 'required', {
      namespace: input.namespace,
    });
    const raw = syncMirror();
    if (!(raw instanceof OpfsFsSync)) throw new Error('owner is not using OpfsFsSync');
    await seed(raw);
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(input.namespace);
    return { storage: authority.snapshot, segments: await referencedSegments(root) };
  }
  if (input.kind === 'legacy') {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(
      input.namespace,
      { create: true },
    );
    const legacy = await installOpfsFs(root);
    const path = '/.rifty/workbench/v1/projects/old/tree/legacy-edit.txt';
    legacy.fsSync.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    legacy.fsSync.writeFileSync(path, encoder.encode('legacy edit survives physically'));
    if ((await legacy.fsSync.flush()).total) throw new Error('legacy seed unclean');
    legacy.fsSync.closeAll();
    const getFile = FileSystemFileHandle.prototype.getFile;
    let reads = 0;
    FileSystemFileHandle.prototype.getFile = function () {
      if (this.name === 'legacy-edit.txt') reads++;
      return getFile.call(this);
    };
    let fresh: Awaited<ReturnType<typeof open>>;
    try {
      fresh = await open(input.namespace);
    } finally {
      FileSystemFileHandle.prototype.getFile = getFile;
    }
    return {
      reads,
      hasLegacy: fresh.fsSync.existsSync(path),
      issue: (fresh as unknown as { layoutIssue?: { kind: string } }).layoutIssue,
      native: new TextDecoder().decode(await legacy.vfs.readFile(path)),
    };
  }
  if (input.kind === 'configured') {
    const backend = await initBackend({ persistence: 'required', namespace: input.namespace });
    const raw = syncMirror();
    if (!(raw instanceof OpfsFsSync)) throw new Error('configured storage lost OpfsFsSync');
    await seed(raw);
    raw.closeAll();
    const fresh = await open(input.namespace);
    let segmented = true;
    try {
      await fresh.root.getDirectoryHandle('.rifty-replica-v1');
    } catch (error) {
      if ((error as { name?: string }).name !== 'NotFoundError') throw error;
      segmented = false;
    }
    return {
      backend,
      segmented,
      isolated: self.crossOriginIsolated,
      text: new TextDecoder().decode(fresh.fsSync.readFileBytesSync('/tree/a.txt')),
    };
  }

  if (input.kind === 'release') {
    release?.();
    return;
  }
  if (input.kind === 'close') {
    fs?.closeAll();
    return { closed: true };
  }
  if (input.kind === 'contend') {
    try {
      await open(input.namespace);
      return { acquired: true };
    } catch (e) {
      return { acquired: false, error: String(e) };
    }
  }
  const started = performance.now();
  const pair = await open(input.namespace, input.kind === 'hold' ? 40 : 30000);
  const restoreMs = performance.now() - started;
  const current = pair.fsSync;
  if (
    input.kind === 'scale-write' ||
    input.kind === 'scale-read' ||
    input.kind === 'scale-mutate'
  ) {
    let flushMs = 0;
    if (input.kind !== 'scale-read') {
      const entries = (manifest.files as [string, number][]).slice(
        0,
        input.kind === 'scale-mutate' ? 5000 : undefined,
      );
      for (const [entryIndex, [relative, size]] of entries.entries()) {
        const path = `/workspace/node_modules/${relative}`;
        const dir = path.slice(0, path.lastIndexOf('/'));
        if (!current.existsSync(dir)) current.mkdirSync(dir, { recursive: true });
        const data = new Uint8Array(size).fill(input.kind === 'scale-mutate' ? 84 : 73);
        for (let byte = 0; byte < Math.min(4, size); byte++)
          data[byte] = (entryIndex >>> (byte * 8)) & 255;
        current.writeFileSync(path, data);
      }
      const tail = performance.now();
      const clean = await current.flush();
      flushMs = performance.now() - tail;
      if (clean.total) throw new Error(`unclean scale drain: ${clean.total}`);
    }
    let index = 0;
    for (const [relative, size] of manifest.files as [string, number][]) {
      const bytes = current.readFileBytesSync(`/workspace/node_modules/${relative}`);
      const expected = (input.mutated || input.kind === 'scale-mutate') && index < 5000 ? 84 : 73;
      if (
        bytes.length !== size ||
        !bytes.every(
          (byte, position) => byte === (position < 4 ? (index >>> (position * 8)) & 255 : expected),
        )
      )
        throw new Error(`replay bytes differ: ${relative}`);
      index++;
    }
    current.closeAll();
    return { restoreMs, flushMs, files: index, bytes: manifest.stats.totalBytes };
  }
  if (input.kind === 'verify')
    return {
      tree: snapshot(current),
      segments: await referencedSegments(pair.root),
      issue: pair.layoutIssue,
    };
  if (!(input.kind === 'crash' && input.firstCommit)) {
    const restore = input.slowSeed
      ? faultNative(async (_name, phase) => {
          if (phase === 'before-close') await new Promise((resolve) => setTimeout(resolve, 80));
        })
      : () => {};
    try {
      await seed(current);
    } finally {
      restore();
    }
  }
  if (input.kind === 'spin') {
    self.postMessage({ ok: true, result: { tree: snapshot(current) } });
    while (true) {}
  }
  if (input.kind === 'corrupt-during-append') {
    const directory = await pair.root.getDirectoryHandle('.rifty-replica-v1');
    const head = JSON.parse(
      await (await (await directory.getFileHandle('HEAD')).getFile()).text(),
    ) as { segments: string[] };
    const originalSegment = await directory.getFileHandle(`segment-${head.segments[0]}.bin`);
    let releaseHead!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHead = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let armed = true;
    const restore = faultNative(async (name, phase) => {
      if (armed && name === 'HEAD' && phase === 'before-close') {
        armed = false;
        reached();
        await held;
      }
    });
    current.writeFileSync('/tree/b.txt', encoder.encode('unrelated'));
    const flushing = current.flush();
    await blocked;
    const damaged = new Uint8Array(await (await originalSegment.getFile()).arrayBuffer()).fill(0);
    const writer = await originalSegment.createWritable();
    await writer.write(damaged);
    await writer.close();
    let rejected = false;
    try {
      await pair.vfs.readFile('/tree/a.txt');
    } catch {
      rejected = true;
    }
    releaseHead();
    await flushing;
    restore();
    current.writeFileSync('/tree/a.txt', encoder.encode('repaired'));
    const clean = await current.flush();
    current.closeAll();
    const fresh = await open(input.namespace);
    return {
      rejected,
      clean: clean.total,
      issue: fresh.layoutIssue?.kind,
      a: fresh.fsSync.existsSync('/tree/a.txt')
        ? new TextDecoder().decode(fresh.fsSync.readFileBytesSync('/tree/a.txt'))
        : null,
      b: fresh.fsSync.existsSync('/tree/b.txt')
        ? new TextDecoder().decode(fresh.fsSync.readFileBytesSync('/tree/b.txt'))
        : null,
    };
  }
  if (input.kind === 'corrupt' || input.kind === 'native-read-error') {
    let damagedFile: FileSystemFileHandle | undefined;
    let damagedBytes: Uint8Array<ArrayBuffer> | undefined;
    if (input.kind === 'corrupt') {
      let file: FileSystemFileHandle;
      try {
        const directory = await pair.root.getDirectoryHandle('.rifty-replica-v1');
        if (input.damage === 'head') file = await directory.getFileHandle('HEAD');
        else {
          const names: string[] = [];
          for await (const [name] of directory as unknown as AsyncIterable<
            [string, FileSystemHandle]
          >)
            if (name.startsWith('segment-')) names.push(name);
          const name = names[0];
          if (!name) throw new Error('committed segment absent');
          file = await directory.getFileHandle(name);
        }
      } catch (error) {
        if ((error as { name?: string }).name !== 'NotFoundError') throw error;
        // Current baseline's physical carrier; mutate real persisted user bytes.
        file = await (await pair.root.getDirectoryHandle('tree')).getFileHandle('a.txt');
      }
      const bytes = new Uint8Array(await (await file.getFile()).arrayBuffer());
      bytes[Math.floor(bytes.length / 2)]! ^= 255;
      if (input.damage === 'live-native') bytes.fill(0);
      const stream = await file.createWritable();
      damagedBytes =
        input.damage === 'truncate' ? bytes.slice(0, Math.floor(bytes.length / 2)) : bytes;
      damagedFile = file;
      await stream.write(damagedBytes);
      await stream.close();
      if (input.damage === 'live-native') {
        const cache = new TextDecoder().decode(current.readFileBytesSync('/tree/a.txt'));
        try {
          await pair.vfs.readFile('/tree/a.txt');
          return { cache, rejected: false };
        } catch (error) {
          return { cache, rejected: true, message: String(error) };
        }
      }
    } else {
      const original = FileSystemFileHandle.prototype.getFile;
      FileSystemFileHandle.prototype.getFile = function () {
        if (this.name === 'HEAD' || this.name === 'a.txt')
          return Promise.reject(new DOMException('native-read-denied', 'NotReadableError'));
        return original.call(this);
      };
    }
    current.closeAll();
    try {
      if (input.kind === 'native-read-error' && input.policy) {
        await installWorkbenchOwnerStorageAuthority(input.policy, { namespace: input.namespace });
        return { rejected: false };
      }
      const fresh = await open(input.namespace);
      const retained =
        damagedFile === undefined
          ? true
          : await damagedFile.getFile().then(
              async (file) => {
                const actual = new Uint8Array(await file.arrayBuffer());
                return (
                  actual.length === damagedBytes?.length &&
                  actual.every((byte, index) => byte === damagedBytes?.[index])
                );
              },
              () => false,
            );
      return {
        rejected: false,
        hasFile: fresh.fsSync.existsSync('/tree/a.txt'),
        retained,
        issue: (fresh as unknown as { layoutIssue?: { kind: string } }).layoutIssue,
      };
    } catch (error) {
      return { rejected: true, name: (error as Error).name, message: String(error) };
    }
  }
  if (input.kind === 'compaction-quota') {
    current.writeFileSync('/tree/untouched.bin', new Uint8Array(65536).fill(47));
    await current.flush();
    for (let index = 0; index < 62; index++) {
      current.writeFileSync('/tree/a.txt', encoder.encode(`round-${index}`));
      await current.flush();
    }
    const before = snapshot(current);
    const restore = faultNative(async (_name, phase, data) => {
      if (phase === 'write' && writeSize(data) > 32768)
        throw new DOMException('compaction-quota', 'QuotaExceededError');
    });
    current.writeFileSync('/tree/a.txt', encoder.encode('new-a'));
    current.writeFileSync('/tree/b.txt', encoder.encode('new-b'));
    const dirty = report(await current.flush());
    restore();
    current.closeAll();
    const fresh = await open(input.namespace);
    return { dirty, before, actual: snapshot(fresh.fsSync) };
  }
  if (input.kind === 'roundtrip') {
    current.mkdirSync('/tree/nested', {});
    current.writeFileSync('/tree/nested/bytes', new Uint8Array([0, 255, 128, 1]));
    current.renameSync('/tree/nested', '/tree/moved');
    current.rmSync('/tree/a.txt');
    current.mkdirSync('/tree/a.txt', {});
    current.copyFileSync('/tree/moved/bytes', '/tree/a.txt/copy');
    await current.flush();
    current.utimes('/tree/a.txt/copy', 12000, 34000);
    const clean = await current.flush();
    const expected = snapshot(current);
    const native = await pair.vfs.readFile('/tree/a.txt/copy');
    current.closeAll();
    const fresh = await open(input.namespace);
    return { clean: report(clean), expected, actual: snapshot(fresh.fsSync), native: [...native] };
  }
  if (input.kind === 'quota') {
    let failed = false;
    const restore = faultNative(async (_name, phase) => {
      if (!failed && phase === 'write') {
        failed = true;
        throw new DOMException('replica-quota', 'QuotaExceededError');
      }
    });
    for (let i = 0; i < 230; i++)
      current.writeFileSync(`/tree/file-${i}`, encoder.encode(`value-${i}`));
    const dirty = report(await current.flush());
    restore();
    current.writeFileSync('/tree/file-229', encoder.encode('healed'));
    const healed = report(await current.flush());
    return { dirty, healed };
  }
  if (input.kind === 'hold') {
    let armed = true;
    const events: string[] = [];
    const restore = faultNative(async (name, phase) => {
      if (armed && phase === 'before-close') {
        armed = false;
        events.push(`held:${name}`);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });
    current.writeFileSync('/tree/a.txt', encoder.encode('new-a'));
    current.writeFileSync('/tree/b.txt', encoder.encode('new-b'));
    let fenced = false;
    void current.fence().then(() => {
      fenced = true;
    });
    const dirty = report(await current.flush());
    self.postMessage({ ok: true, result: { phase: 'timed-out', dirty, fenced, events } });
    await current.fence();
    restore();
    return { phase: 'settled', clean: report(await current.flush()), tree: snapshot(current) };
  }
  if (input.kind === 'crash') {
    for (let i = 0; i < (input.rounds ?? 0); i++) {
      current.writeFileSync('/tree/a.txt', encoder.encode(`round-${i}`));
      current.writeFileSync('/tree/b.txt', encoder.encode(`round-${i}`));
      if ((await current.flush()).total) throw new Error('round unclean');
    }
    const before = snapshot(current);
    faultNative(async (name, phase) => {
      if (phase === input.phase && (name === 'HEAD' || name === 'a.txt')) {
        const directory = await pair.root.getDirectoryHandle('.rifty-replica-v1');
        const headBytes = (await (await directory.getFileHandle('HEAD')).getFile()).size;
        self.postMessage({ ok: true, result: { phase: 'paused', before, headBytes } });
        await new Promise<void>(() => {});
      }
    });
    if (input.firstCommit) current.mkdirSync('/tree');
    current.writeFileSync('/tree/a.txt', encoder.encode('new-a'));
    current.writeFileSync('/tree/b.txt', encoder.encode('new-b'));
    await current.flush();
    throw new Error('native crash point not reached');
  }
  throw new Error('unknown input');
}
self.onmessage = ({ data }: MessageEvent<Input>) => {
  void run(data).then(
    (result) => {
      if (result !== undefined) self.postMessage({ ok: true, result });
    },
    (error: unknown) => self.postMessage({ ok: false, error: String(error) }),
  );
};
