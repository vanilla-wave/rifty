import { VfsError } from './errors.ts';
import { type OpfsErrorContext, mapOpfsError } from './opfs-errors.ts';
import { OpfsReplicaStore } from './opfs-replica-store.ts';
import type { OpfsLayoutIssue } from './opfs-replica-types.ts';
import { OpfsFsSync } from './opfs-sync.ts';
import { chunkedFileStream } from './opfs.ts';
import { normalizeAbsolute } from './path.ts';
import type { Vfs, VfsDirent, VfsStat } from './types.ts';

class ReplicaVfs implements Vfs {
  constructor(
    private readonly store: OpfsReplicaStore,
    private readonly sync: () => OpfsFsSync,
  ) {}

  private async native<T>(
    path: string,
    context: OpfsErrorContext,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throw error instanceof VfsError ? error : mapOpfsError(error, path, context);
    }
  }

  async readFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
    const normalized = normalizeAbsolute(path);
    return this.native(normalized, 'file', () => this.store.readFile(normalized));
  }

  async readFileText(path: string, _encoding: 'utf8' = 'utf8'): Promise<string> {
    return new TextDecoder().decode(await this.readFile(path));
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const normalized = normalizeAbsolute(path);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return this.native(normalized, 'file', () =>
      this.sync().persistMutation(() => this.sync().writeFileSync(normalized, bytes)),
    );
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = normalizeAbsolute(path);
    return this.native(normalized, 'dir', () =>
      this.sync().persistMutation(() => this.sync().mkdirSync(normalized, options)),
    );
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const normalized = normalizeAbsolute(path);
    return this.native(normalized, 'file', () =>
      this.sync().persistMutation(() => this.sync().rmSync(normalized, options)),
    );
  }

  async utimes(path: string, atimeMs: number, mtimeMs: number): Promise<void> {
    const normalized = normalizeAbsolute(path);
    return this.native(normalized, 'file', () =>
      this.sync().persistMutation(() => this.sync().utimes(normalized, atimeMs, mtimeMs)),
    );
  }

  async stat(path: string): Promise<VfsStat> {
    const normalized = normalizeAbsolute(path);
    return this.native(normalized, 'file', () => this.store.stat(normalized));
  }

  async readdir(path: string): Promise<readonly VfsDirent[]> {
    const normalized = normalizeAbsolute(path);
    return this.native(normalized, 'dir', () => this.store.readdir(normalized));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (error) {
      if (error instanceof VfsError && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async openReadable(
    path: string,
    options?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    return chunkedFileStream(new Blob([await this.readFile(path)]), options);
  }
}

export async function createReplicaPair(
  root: FileSystemDirectoryHandle,
  options: { readonly ioReportTimeoutMs?: number },
): Promise<{
  readonly vfs: Vfs;
  readonly fsSync: OpfsFsSync;
  readonly layoutIssue?: OpfsLayoutIssue;
}> {
  const { store, images } = await OpfsReplicaStore.open(root, options.ioReportTimeoutMs);
  let fsSync: OpfsFsSync;
  const vfs = new ReplicaVfs(store, () => fsSync);
  try {
    fsSync = new OpfsFsSync(root, vfs, { ...options, replica: store, initialImage: images });
  } catch (error) {
    store.closeAfter(Promise.resolve());
    throw error;
  }
  return { vfs, fsSync, ...(store.layoutIssue ? { layoutIssue: store.layoutIssue } : {}) };
}
