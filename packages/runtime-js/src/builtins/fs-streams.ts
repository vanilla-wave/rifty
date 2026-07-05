/**
 * Node-style `fs.createReadStream` / `fs.createWriteStream`.
 *
 * Built on top of the EventEmitter we already ship — the M5 streams package
 * adds a full Readable/Writable hierarchy. The read path uses `Vfs.openReadable`
 * first (ADR-0020 phase 2 true streaming); the sync mirror is only the fallback
 * when no async VFS is installed. Event order matches Node:
 * `open` → `ready` → `data*` → `end` → `close` / `finish` → `close`.
 *
 * Paths resolve against process.cwd() via the shared fs-path kit and errors
 * surface Node-shaped (fs-errors kit) — both were review 2026-07-05 findings
 * (relative stream paths silently hit `/`, `{flags:'a'}` silently overwrote).
 * Write streams honor `flags` ('w'/'a'/exclusive 'x' family/'r+') with Node's
 * truncate-at-open semantics and write THROUGH to the mirror per macrotask
 * burst, so a long-lived logger's output is visible before `end()`.
 *
 * Loud gaps (NotImplementedError, never silent accept-and-ignore): `fd`, `fs`,
 * write-stream `start`, `autoClose:false`. `mode` is accepted: the VFS has no
 * permission bits, so there is genuinely nothing to apply (same precedent as
 * `lstat === stat`, ADR-0050).
 */

import { NotImplementedError } from '@riftydev/io';
import { asyncVfs } from '@riftydev/vfs';
import { Buffer } from './buffer.ts';
import { EventEmitter } from './events.ts';
import { fsError, toNodeFsError } from './fs-errors.ts';
import { pathToString, resolvePath } from './fs-path.ts';
import { syncMirror } from './fs-sync-mirror.ts';

interface ReadStreamOptions {
  flags?: string;
  encoding?: string;
  fd?: unknown;
  mode?: number;
  autoClose?: boolean;
  emitClose?: boolean;
  start?: number;
  end?: number;
  highWaterMark?: number;
  fs?: unknown;
  signal?: AbortSignal;
}

interface WriteStreamOptions {
  flags?: string;
  encoding?: string;
  fd?: unknown;
  mode?: number;
  autoClose?: boolean;
  emitClose?: boolean;
  start?: number;
  highWaterMark?: number;
  fs?: unknown;
}

/** Reject Node option fields this implementation cannot honor — loudly. */
function assertSupportedStreamOptions(
  opts: ReadStreamOptions | WriteStreamOptions,
  surface: string,
  extra: readonly (keyof ReadStreamOptions & keyof WriteStreamOptions)[] = [],
): void {
  if (opts.fd !== undefined && opts.fd !== null) throw new NotImplementedError(`${surface}.fd`);
  if (opts.fs !== undefined && opts.fs !== null) throw new NotImplementedError(`${surface}.fs`);
  if (opts.autoClose === false) throw new NotImplementedError(`${surface}.autoClose:false`);
  for (const key of extra) {
    if (opts[key] !== undefined) throw new NotImplementedError(`${surface}.${key}`);
  }
}

/** Node throws ERR_OUT_OF_RANGE SYNCHRONOUSLY at createReadStream for a bad window. */
function assertStreamRange(name: string, value: number | undefined, min = 0): void {
  if (value !== undefined && (!Number.isInteger(value) || value < min)) {
    throw Object.assign(
      new RangeError(`The value of "${name}" is out of range. Received ${value}`),
      { code: 'ERR_OUT_OF_RANGE' },
    );
  }
}

interface ParsedStreamFlags {
  readonly append: boolean;
  readonly exclusive: boolean;
  readonly truncate: boolean;
  readonly mustExist: boolean;
}

function parseWriteFlags(flags: string, surface: string): ParsedStreamFlags {
  switch (flags) {
    case 'w':
    case 'w+':
      return { append: false, exclusive: false, truncate: true, mustExist: false };
    case 'wx':
    case 'xw':
    case 'wx+':
    case 'xw+':
      return { append: false, exclusive: true, truncate: true, mustExist: false };
    case 'a':
    case 'a+':
      return { append: true, exclusive: false, truncate: false, mustExist: false };
    case 'ax':
    case 'xa':
    case 'ax+':
    case 'xa+':
      return { append: true, exclusive: true, truncate: false, mustExist: false };
    case 'r+':
      return { append: false, exclusive: false, truncate: false, mustExist: true };
    default:
      throw new NotImplementedError(`${surface}.flags:'${flags}'`);
  }
}

class FileReadStream extends EventEmitter {
  readonly path: string;
  private readonly opts: ReadStreamOptions;
  private destroyed = false;

  constructor(path: string, opts: ReadStreamOptions = {}) {
    super();
    assertSupportedStreamOptions(opts, 'fs.createReadStream');
    if (opts.flags !== undefined && opts.flags !== 'r') {
      // Non-'r' read-stream flags change open side-effects we don't model.
      throw new NotImplementedError(`fs.createReadStream.flags:'${opts.flags}'`);
    }
    assertStreamRange('start', opts.start);
    assertStreamRange('end', opts.end);
    assertStreamRange('highWaterMark', opts.highWaterMark, 1);
    if (opts.start !== undefined && opts.end !== undefined && opts.end < opts.start) {
      throw Object.assign(
        new RangeError(`The value of "start" is out of range. Received ${opts.start}`),
        { code: 'ERR_OUT_OF_RANGE' },
      );
    }
    this.path = path;
    this.opts = opts;
    if (opts.signal) {
      if (opts.signal.aborted) {
        queueMicrotask(() => this.abort());
      } else {
        opts.signal.addEventListener('abort', () => this.abort(), { once: true });
      }
    }
    queueMicrotask(() => this.start());
  }

  private abort(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const err = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
      code: 'ABORT_ERR',
    });
    this.emit('error', err);
    this.emit('close');
  }

  private emitError(err: unknown): void {
    this.emit('error', toNodeFsError(err, 'open', this.path));
  }

  private start(): void {
    if (this.destroyed) return;
    const hwm = this.opts.highWaterMark ?? 64 * 1024;
    // Node's `createReadStream` byte range is INCLUSIVE of `end`; the half-open
    // `Vfs.openReadable` / sync-slice surfaces are exclusive — convert here so the
    // last byte is delivered (parity: {start,end} reads end-start+1 bytes).
    const exclusiveEnd = this.opts.end !== undefined ? this.opts.end + 1 : undefined;
    const emitChunkBytes = (bytes: Uint8Array): void => {
      const chunk = this.opts.encoding
        ? (Buffer.from(bytes) as Uint8Array & { toString(e?: string): string }).toString(
            this.opts.encoding,
          )
        : Buffer.from(bytes);
      this.emit('data', chunk);
    };

    // Whole-file emit from a byte buffer, chunked across microtasks so the event
    // loop is not starved. Applies the `start`/`end` window.
    const emitFromBytes = (data: Uint8Array): void => {
      if (this.destroyed) return;
      const start = this.opts.start ?? 0;
      const end = Math.min(exclusiveEnd ?? data.length, data.length);
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
      this.emit('ready');
      emitChunk();
    };

    const np = resolvePath(this.path);
    const vfs = asyncVfs();
    if (vfs) {
      vfs
        .openReadable(np, {
          chunkSize: hwm,
          start: this.opts.start,
          end: exclusiveEnd,
        })
        .then(async (stream) => {
          if (this.destroyed) {
            await stream.cancel().catch(() => {});
            return;
          }
          this.emit('open', 0);
          this.emit('ready');
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
            this.emitError(err);
          }
        })
        .catch((err) => this.emitError(err));
      return;
    }

    // No async surface: serve from the sync mirror, still chunked over
    // microtasks to preserve stream event order.
    try {
      emitFromBytes(syncMirror().readFileBytesSync(np));
    } catch (err) {
      this.emitError(err);
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
  private readonly emitCloseOpt: boolean;
  private readonly flags: ParsedStreamFlags;
  /** Full file image; writes overlay at {@link pos} (r+ overwrites, a appends). */
  private bytes: Uint8Array = new Uint8Array();
  private pos = 0;
  /**
   * Chunks written BEFORE the open() microtask ran (Node buffers pre-open
   * writes). open() initialises {@link bytes}/{@link pos} from the file, THEN
   * overlays these — a plain write() here would be wiped by that init.
   */
  private preOpen: Uint8Array[] | null = [];
  private opened = false;
  private failed = false;
  private destroyed = false;
  private finished = false;
  private flushScheduled = false;

  constructor(path: string, opts: WriteStreamOptions = {}) {
    super();
    assertSupportedStreamOptions(opts, 'fs.createWriteStream', ['start']);
    this.flags = parseWriteFlags(opts.flags ?? 'w', 'fs.createWriteStream');
    this.emitCloseOpt = opts.emitClose ?? true;
    this.path = path;
    queueMicrotask(() => this.open());
  }

  /**
   * Node's open side-effects happen at OPEN, not at end(): 'w' truncates the
   * file immediately, 'a' creates a missing file, exclusive flags raise
   * EEXIST, 'r+' requires existence. Failures are Node-shaped 'error' EVENTS.
   */
  private open(): void {
    if (this.destroyed) return;
    const np = resolvePath(this.path);
    try {
      const exists = syncMirror().existsSync(np);
      if (exists && this.flags.exclusive) {
        throw fsError('EEXIST', pathToString(this.path), 'open');
      }
      if (!exists && this.flags.mustExist) {
        throw fsError('ENOENT', pathToString(this.path), 'open');
      }
      this.bytes =
        exists && !this.flags.truncate
          ? syncMirror().readFileBytesSync(np).slice()
          : new Uint8Array();
      this.pos = this.flags.append ? this.bytes.length : 0;
      this.opened = true;
      const buffered = this.preOpen ?? [];
      this.preOpen = null;
      for (const chunk of buffered) this.overlay(chunk);
      // Truncate/create at open even if nothing is ever written.
      syncMirror().writeFileSync(np, this.bytes);
      this.emit('open', 0);
      this.emit('ready');
    } catch (err) {
      this.failed = true;
      this.emit('error', toNodeFsError(err, 'open', this.path));
      if (this.emitCloseOpt) this.emit('close');
    }
  }

  write(chunk: Uint8Array | string, encoding?: string, cb?: (err?: unknown) => void): boolean {
    if (this.failed || this.destroyed || this.finished) {
      queueMicrotask(() => cb?.(fsError('EBADF', this.path, 'write')));
      return false;
    }
    const buf =
      typeof chunk === 'string' ? Buffer.from(chunk, (encoding ?? 'utf8') as never) : chunk;
    if (this.preOpen !== null) {
      // Not yet open: buffer; open() overlays these onto the file image.
      this.preOpen.push(buf);
    } else {
      this.overlay(buf);
      this.scheduleFlush();
    }
    queueMicrotask(() => cb?.());
    return true;
  }

  private overlay(buf: Uint8Array): void {
    const needed = this.pos + buf.length;
    if (needed > this.bytes.length) {
      const grown = new Uint8Array(needed);
      grown.set(this.bytes, 0);
      this.bytes = grown;
    }
    this.bytes.set(buf, this.pos);
    this.pos = needed;
  }

  /**
   * Write-through per macrotask burst: data written without `end()` still
   * lands in the mirror (Node visibility — a long-lived logger's file is
   * readable while the stream stays open), while a tight write loop costs one
   * mirror write per burst instead of one per chunk.
   */
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      if (this.failed || this.destroyed) return;
      // open() runs before any flush (both are microtasks, open queued first).
      this.persist();
    });
  }

  private persist(): void {
    try {
      syncMirror().writeFileSync(resolvePath(this.path), this.bytes);
    } catch (err) {
      this.failed = true;
      this.emit('error', toNodeFsError(err, 'write', this.path));
    }
  }

  end(chunk?: Uint8Array | string, cb?: () => void): void {
    if (chunk !== undefined) this.write(chunk);
    queueMicrotask(() => {
      if (this.failed || this.destroyed || this.finished) return;
      this.finished = true;
      if (this.opened) this.persist();
      if (this.failed) return;
      this.emit('finish');
      if (this.emitCloseOpt) this.emit('close');
      cb?.();
    });
  }

  /** Node semantics: destroy discards buffered-but-unflushed data, no 'finish'. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.emitCloseOpt) this.emit('close');
  }
}

export function createReadStream(path: string, opts?: ReadStreamOptions): FileReadStream {
  return new FileReadStream(path, opts);
}

export function createWriteStream(path: string, opts?: WriteStreamOptions): FileWriteStream {
  return new FileWriteStream(path, opts);
}

export { FileReadStream, FileWriteStream };
