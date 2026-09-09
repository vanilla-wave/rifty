/// <reference lib="webworker" />
import { OpfsVfs } from '@riftydev/vfs';
import { installOpfsFs } from '@riftydev/vfs/internal';

declare const self: DedicatedWorkerGlobalScope;

export interface NamespaceRequest {
  readonly mode?: 'mount' | 'reinit';
  readonly namespace?: string;
  readonly write?: string;
}

interface MountObservation {
  readonly before: {
    readonly roots: readonly string[];
    readonly outside: readonly number[] | null;
    readonly existing: readonly number[] | null;
    readonly prior: readonly number[] | null;
    readonly cache: readonly number[] | null;
  };
  readonly preloadReadNames: readonly string[];
  readonly persisted?: readonly number[];
  readonly asyncRead?: readonly number[] | null;
}

export type NamespaceReply =
  | { readonly ok: true; readonly mount: MountObservation }
  | {
      readonly ok: true;
      readonly reinit: { readonly refused: boolean; readonly existing: readonly number[] };
    }
  | { readonly ok: false; readonly name: string; readonly message: string };

// Candidate I4 overload: baseline ignores the extra handle, producing semantic RED.
const installSelected = installOpfsFs as (
  root?: FileSystemDirectoryHandle,
) => ReturnType<typeof installOpfsFs>;
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function inspect(request: NamespaceRequest): Promise<NamespaceReply> {
  const origin = await navigator.storage.getDirectory();
  if (request.mode === 'reinit') {
    const a = await origin.getDirectoryHandle('A');
    const b = await origin.getDirectoryHandle('B', { create: true });
    const vfs = new OpfsVfs();
    const initialize = vfs.init.bind(vfs) as (root?: FileSystemDirectoryHandle) => Promise<void>;
    await initialize(a);
    await vfs.init();
    await initialize(await origin.getDirectoryHandle('A'));
    let refused = false;
    try {
      await initialize(b);
    } catch {
      refused = true;
    }
    return {
      ok: true,
      reinit: { refused, existing: Array.from(await vfs.readFile('/existing.bin')) },
    };
  }

  const selected =
    request.namespace === undefined
      ? undefined
      : await origin.getDirectoryHandle(request.namespace, { create: true });
  const preloadReadNames: string[] = [];
  const nativeGetFile = FileSystemFileHandle.prototype.getFile;
  // Observe real native reads; the original browser operation still performs every read.
  FileSystemFileHandle.prototype.getFile = function () {
    preloadReadNames.push(this.name);
    return nativeGetFile.call(this);
  };
  const pair = await (async () => {
    try {
      return selected === undefined ? await installOpfsFs() : await installSelected(selected);
    } finally {
      FileSystemFileHandle.prototype.getFile = nativeGetFile;
    }
  })();
  try {
    const readSync = (path: string): number[] | null =>
      pair.fsSync.existsSync(path) ? Array.from(pair.fsSync.readFileBytesSync(path)) : null;
    const before = {
      roots: pair.fsSync
        .readdirSync('/')
        .map((entry) => entry.name)
        .sort(),
      outside: readSync('/outside-sentinel.bin'),
      existing: readSync('/existing.bin'),
      prior: readSync('/roundtrip.bin'),
      cache: readSync('/.rifty/tarball-cache/probe.bin'),
    };
    if (request.write === undefined) return { ok: true, mount: { before, preloadReadNames } };
    pair.fsSync.writeFileSync('/roundtrip.bin', bytes(request.write));
    pair.fsSync.writeFileSync('/outside-sentinel.bin', bytes(`inside:${request.write}`));
    pair.fsSync.mkdirSync('/.rifty/tarball-cache', { recursive: true });
    pair.fsSync.writeFileSync('/.rifty/tarball-cache/probe.bin', bytes(`cache:${request.write}`));
    const flushed = await pair.fsSync.flush();
    if (flushed.total !== 0) throw new Error(`flush failed: ${JSON.stringify(flushed)}`);
    const persisted = Array.from(await pair.vfs.readFile('/roundtrip.bin'));
    await pair.vfs.writeFile('/async.bin', bytes(`async:${request.write}`));
    await pair.fsSync.refreshIndex();
    await pair.fsSync.preloadContent();
    return {
      ok: true,
      mount: { before, preloadReadNames, persisted, asyncRead: readSync('/async.bin') },
    };
  } finally {
    pair.fsSync.closeAll();
  }
}

self.onmessage = (event: MessageEvent<NamespaceRequest>) => {
  void inspect(event.data).then(
    (reply) => self.postMessage(reply),
    (error: unknown) =>
      self.postMessage({
        ok: false,
        name: error instanceof Error ? error.name : '',
        message: error instanceof Error ? error.message : String(error),
      } satisfies NamespaceReply),
  );
};
