/**
 * A `Vfs` (async interface) that delegates everything to `syncMirror()`.
 *
 * Why: `@riftydev/npm-client` writes installed package files via `vfs.writeFile`
 * (async), while Vite reads them via `fs.readFileSync` (sync, backed by
 * `syncMirror`). Without this bridge the installed tree would be invisible to
 * the runtime. Here writes land directly in the sync mirror so the very next
 * `fs.readFileSync` sees them.
 */
import type { FsSync, Vfs, VfsDirent, VfsStat } from '@riftydev/vfs';
import { dirname, normalizePath, syncMirror } from '@riftydev/vfs';

const enc = new TextEncoder();
const dec = new TextDecoder();

export class SyncMirrorVfs implements Vfs {
  constructor(private readonly getFs: () => FsSync = syncMirror) {}

  async readFile(path: string): Promise<Uint8Array> {
    return this.getFs().readFileBytesSync(normalizePath(path));
  }
  async readFileText(path: string): Promise<string> {
    return dec.decode(this.getFs().readFileBytesSync(normalizePath(path)));
  }
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const np = normalizePath(path);
    const parent = dirname(np);
    const fs = this.getFs();
    fs.mkdirSync(parent, { recursive: true });
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    fs.writeFileSync(np, bytes);
  }
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.getFs().mkdirSync(normalizePath(path), { recursive: options?.recursive ?? false });
  }
  async readdir(path: string): Promise<readonly VfsDirent[]> {
    return this.getFs().readdirSync(normalizePath(path));
  }
  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    this.getFs().rmSync(normalizePath(path), {
      recursive: options?.recursive ?? false,
      force: options?.force ?? false,
    });
  }
  async stat(path: string): Promise<VfsStat> {
    const st = this.getFs().statSync(normalizePath(path));
    return { ...st, size: st.size ?? 0, mtime: st.mtime ?? 0 };
  }
  async exists(path: string): Promise<boolean> {
    return this.getFs().existsSync(normalizePath(path));
  }
  async utimes(path: string, atimeMs: number, mtimeMs: number): Promise<void> {
    this.getFs().utimes(normalizePath(path), atimeMs, mtimeMs);
  }
  async openReadable(
    path: string,
    opts?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    const data = this.getFs().readFileBytesSync(normalizePath(path));
    const start = opts?.start ?? 0;
    const end = Math.min(opts?.end ?? data.byteLength, data.byteLength);
    const chunkSize = opts?.chunkSize ?? 64 * 1024;
    let offset = start;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= end) {
          controller.close();
          return;
        }
        const next = Math.min(offset + chunkSize, end);
        controller.enqueue(data.subarray(offset, next));
        offset = next;
      },
    });
  }
}
