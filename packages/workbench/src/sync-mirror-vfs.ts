/**
 * A `Vfs` (async interface) that delegates everything to `syncMirror()`.
 *
 * Why: `@riftydev/npm-client` writes installed package files via `vfs.writeFile`
 * (async), while Vite reads them via `fs.readFileSync` (sync, backed by
 * `syncMirror`). Without this bridge the installed tree would be invisible to
 * the runtime. Here writes land directly in the sync mirror so the very next
 * `fs.readFileSync` sees them.
 */
import type { Vfs, VfsDirent, VfsStat } from '@riftydev/vfs';
import { NotImplementedError, dirname, normalizePath, syncMirror } from '@riftydev/vfs';

const enc = new TextEncoder();
const dec = new TextDecoder();

export class SyncMirrorVfs implements Vfs {
  async readFile(path: string): Promise<Uint8Array> {
    return syncMirror().readFileBytesSync(normalizePath(path));
  }
  async readFileText(path: string): Promise<string> {
    return dec.decode(syncMirror().readFileBytesSync(normalizePath(path)));
  }
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const np = normalizePath(path);
    const parent = dirname(np);
    syncMirror().mkdirSync(parent, { recursive: true });
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    syncMirror().writeFileSync(np, bytes);
  }
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    syncMirror().mkdirSync(normalizePath(path), { recursive: options?.recursive ?? false });
  }
  async readdir(path: string): Promise<readonly VfsDirent[]> {
    return syncMirror().readdirSync(normalizePath(path));
  }
  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    syncMirror().rmSync(normalizePath(path), {
      recursive: options?.recursive ?? false,
      force: options?.force ?? false,
    });
  }
  async stat(path: string): Promise<VfsStat> {
    const st = syncMirror().statSync(normalizePath(path));
    return { ...st, size: st.size ?? 0, mtime: st.mtime ?? 0 };
  }
  async exists(path: string): Promise<boolean> {
    return syncMirror().existsSync(normalizePath(path));
  }
  async utimes(path: string, atimeMs: number, mtimeMs: number): Promise<void> {
    syncMirror().utimes(normalizePath(path), atimeMs, mtimeMs);
  }
  async openReadable(
    path: string,
    _opts?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    // ADR 0020 phase 2 (M11): blocked on ADR 0014 split-VFS fix. The sync
    // mirror cannot stream incrementally until the shared-backend issue is
    // resolved; an interim "load-then-chunk" would defeat the purpose. The
    // gap surfaces as a loud `NotImplementedError` (no-silent-stubs) and the
    // hint carries the offending path for diagnostics.
    throw new NotImplementedError('SyncMirrorVfs.openReadable', path);
  }
}
