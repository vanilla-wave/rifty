/**
 * Minimal Node-style `fs.createReadStream` / `fs.createWriteStream`.
 *
 * Built on top of the EventEmitter we already ship — the M5 streams package
 * adds a full Readable/Writable hierarchy. Per ADR-0020 phase 2 the read
 * path now uses `Vfs.openReadable` for true streaming when an async VFS is
 * installed (default in the Worker runtime); otherwise it falls back to the
 * sync mirror's whole-file read, chunked via `queueMicrotask`. Both paths
 * preserve the existing event order (`open` → `data*` → `end` → `close`).
 */

import { asyncVfs } from '@rifty/vfs';
import { Buffer } from './buffer.ts';
import { EventEmitter } from './events.ts';
import { syncMirror } from './fs-sync-mirror.ts';

interface ReadStreamOptions {
  encoding?: string;
  highWaterMark?: number;
  start?: number;
  end?: number;
}

interface WriteStreamOptions {
  encoding?: string;
  flags?: string;
}

class FileReadStream extends EventEmitter {
  readonly path: string;
  private readonly opts: ReadStreamOptions;
  private destroyed = false;

  constructor(path: string, opts: ReadStreamOptions = {}) {
    super();
    this.path = path;
    this.opts = opts;
    queueMicrotask(() => this.start());
  }

  private start(): void {
    const hwm = this.opts.highWaterMark ?? 64 * 1024;
    const emitChunkBytes = (bytes: Uint8Array): void => {
      const chunk = this.opts.encoding
        ? (Buffer.from(bytes) as Uint8Array & { toString(e?: string): string }).toString(
            this.opts.encoding,
          )
        : Buffer.from(bytes);
      this.emit('data', chunk);
    };

    const vfs = asyncVfs();
    if (vfs) {
      // ADR-0020 phase 2: true incremental streaming via Vfs.openReadable.
      vfs
        .openReadable(this.path, {
          chunkSize: hwm,
          start: this.opts.start,
          end: this.opts.end,
        })
        .then(async (stream) => {
          if (this.destroyed) {
            await stream.cancel().catch(() => {});
            return;
          }
          this.emit('open', 0);
          const reader = stream.getReader();
          try {
            while (true) {
              if (this.destroyed) {
                await reader.cancel().catch(() => {});
                return;
              }
              const { value, done } = await reader.read();
              if (done) break;
              if (value && value.byteLength > 0) emitChunkBytes(value);
            }
            this.emit('end');
            this.emit('close');
          } catch (err) {
            this.emit('error', err);
          }
        })
        .catch((err) => this.emit('error', err));
      return;
    }

    // Fallback: sync mirror only. Loads the whole file but still chunks
    // emission across microtasks so the event loop is not starved.
    try {
      const data = syncMirror().readFileBytesSync(this.path);
      if (this.destroyed) return;
      const start = this.opts.start ?? 0;
      const end = Math.min(this.opts.end ?? data.length, data.length);
      let i = start;
      const emitChunk = (): void => {
        if (this.destroyed) return;
        if (i >= end) {
          this.emit('end');
          this.emit('close');
          return;
        }
        const slice = data.subarray(i, Math.min(i + hwm, end));
        i += slice.length;
        emitChunkBytes(slice);
        queueMicrotask(emitChunk);
      };
      this.emit('open', 0);
      emitChunk();
    } catch (err) {
      this.emit('error', err);
    }
  }

  pipe<T extends FileWriteStream>(dest: T): T {
    this.on('data', (chunk: unknown) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Uint8Array);
      dest.write(buf);
    });
    this.on('end', () => dest.end());
    this.on('error', (err) => dest.emit('error', err));
    return dest;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

class FileWriteStream extends EventEmitter {
  readonly path: string;
  private readonly chunks: Uint8Array[] = [];
  private flushed = false;

  constructor(path: string, _opts: WriteStreamOptions = {}) {
    super();
    this.path = path;
    queueMicrotask(() => this.emit('open', 0));
  }

  write(chunk: Uint8Array | string, encoding?: string, cb?: (err?: unknown) => void): boolean {
    const buf =
      typeof chunk === 'string' ? Buffer.from(chunk, (encoding ?? 'utf8') as never) : chunk;
    this.chunks.push(buf);
    queueMicrotask(() => cb?.());
    return true;
  }

  end(chunk?: Uint8Array | string, cb?: () => void): void {
    if (chunk !== undefined) this.write(chunk);
    queueMicrotask(() => this.flush(cb));
  }

  private flush(cb?: () => void): void {
    if (this.flushed) return;
    this.flushed = true;
    try {
      const total = this.chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of this.chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      syncMirror().writeFileSync(this.path, merged);
      this.emit('finish');
      this.emit('close');
      cb?.();
    } catch (err) {
      this.emit('error', err);
    }
  }
}

export function createReadStream(path: string, opts?: ReadStreamOptions): FileReadStream {
  return new FileReadStream(path, opts);
}

export function createWriteStream(path: string, opts?: WriteStreamOptions): FileWriteStream {
  return new FileWriteStream(path, opts);
}

export { FileReadStream, FileWriteStream };
