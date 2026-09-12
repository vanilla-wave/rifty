import { type OpfsFsSync, type Vfs, normalizePath, syncMirror } from '@riftydev/vfs';
import { SyncMirrorVfs } from './sync-mirror-vfs.ts';

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

/** Installer-only skip; the native surface and drain owner jointly prove durability. */
export class InstallMirrorVfs extends SyncMirrorVfs {
  constructor(
    private readonly raw: OpfsFsSync | undefined,
    private readonly native: Vfs,
  ) {
    super();
  }

  override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const normalized = normalizePath(path);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (bytes.byteLength > 0 && this.raw?.isPersistenceClean(normalized)) {
      try {
        const durable = await this.native.readFile(normalized);
        if (
          this.raw.isPersistenceClean(normalized) &&
          equal(durable, bytes) &&
          equal(syncMirror().readFileBytesSync(normalized), bytes)
        )
          return;
      } catch {
        // Unknown/read-failed persistence must take the ordinary repair/failure path.
      }
    }
    await super.writeFile(normalized, bytes);
  }

  override async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = normalizePath(path);
    if (options?.recursive && this.raw?.isPersistenceClean(normalized)) {
      try {
        const durable = await this.native.stat(normalized);
        if (
          durable.isDirectory &&
          this.raw.isPersistenceClean(normalized) &&
          syncMirror().statSync(normalized).isDirectory
        )
          return;
      } catch {
        // Mirror existence cannot heal a ledgered native directory failure.
      }
    }
    await super.mkdir(normalized, options);
  }
}
