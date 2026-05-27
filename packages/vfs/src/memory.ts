/**
 * Async {@link Vfs} view over a {@link MemoryBackend}. By default each
 * `MemoryVfs` owns a fresh backend; pair it with a sibling `MemoryFsSync`
 * via {@link createMemoryFs} to share state across both surfaces (ADR-0014).
 *
 * Per the {@link Vfs} normalisation invariant, every public method normalises
 * its `path` argument before forwarding to the backend.
 *
 * The backend is held in a private slot — there is no public `.backend`
 * field. The only supported way to construct a paired async/sync VFS that
 * share storage is `createMemoryFs()`; reaching into the wrapper for the
 * backend is not a contract any consumer should depend on.
 */
import { MemoryBackend } from './memory-backend.ts';
import { normalizeAbsolute } from './path.ts';
import type { Vfs, VfsDirent, VfsStat } from './types.ts';

const decoder = new TextDecoder('utf-8');

export class MemoryVfs implements Vfs {
  readonly #backend: MemoryBackend;

  constructor(backend?: MemoryBackend) {
    this.#backend = backend ?? new MemoryBackend();
  }

  async readFile(path: string): Promise<Uint8Array> {
    return this.#backend.readFile(normalizeAbsolute(path));
  }

  async readFileText(path: string, _encoding: 'utf8' = 'utf8'): Promise<string> {
    return decoder.decode(this.#backend.readFile(normalizeAbsolute(path)));
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    this.#backend.writeFile(normalizeAbsolute(path), data);
  }

  async readdir(path: string): Promise<readonly VfsDirent[]> {
    return this.#backend.readdirEntries(normalizeAbsolute(path));
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.#backend.mkdir(normalizeAbsolute(path), options);
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    this.#backend.rm(normalizeAbsolute(path), options);
  }

  async stat(path: string): Promise<VfsStat> {
    return this.#backend.stat(normalizeAbsolute(path));
  }

  async exists(path: string): Promise<boolean> {
    return this.#backend.exists(normalizeAbsolute(path));
  }

  async utimes(path: string, atimeMs: number, mtimeMs: number): Promise<void> {
    this.#backend.utimes(normalizeAbsolute(path), atimeMs, mtimeMs);
  }

  async openReadable(
    path: string,
    opts?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    const data = this.#backend.readFile(normalizeAbsolute(path));
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
