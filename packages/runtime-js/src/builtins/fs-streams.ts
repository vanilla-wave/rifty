/**
 * Node-style `fs.createReadStream` / `fs.createWriteStream`.
 *
 * Built on top of the EventEmitter we already ship — the M5 streams package
 * adds a full Readable/Writable hierarchy. The read path uses `Vfs.openReadable`
 * first (ADR-0020 phase 2 true streaming); the sync mirror is only the fallback
 * when no async VFS is installed. Event order matches Node:
 * `open` → `ready` → `data*` → `end` → `close` / `finish` → `close`, with
 * `emitClose:false` suppressing `close` on success, error and destroy alike.
 *
 * Paths resolve against process.cwd() via the shared fs-path kit and errors
 * surface Node-shaped (fs-errors kit) — both were review 2026-07-05 findings
 * (relative stream paths silently hit `/`, `{flags:'a'}` silently overwrote).
 * Write streams honor `flags` ('w'/'a'/exclusive 'x' family/'r+') with Node's
 * truncate-at-open semantics and write THROUGH to the mirror per macrotask
 * burst, so a long-lived logger's output is visible before `end()`.
 * `write`/`end` accept Node's callback overloads (`write(chunk, cb)`,
 * `end(cb)`, `end(chunk, cb)`); post-end/post-destroy writes error the
 * callback with Node's ERR_STREAM_* codes (all verified vs real Node
 * 2026-07-05 — a function in the chunk slot used to be overlaid as an
 * array-like, minting a NUL byte into the file).
 *
 * Loud gaps (NotImplementedError, never silent accept-and-ignore): `fd`, `fs`,
 * write-stream `start`, write-stream `signal`, `autoClose:false`. `mode` is
 * accepted: the VFS has no permission bits, so there is genuinely nothing to
 * apply (same precedent as `lstat === stat`, ADR-0050).
 */

import { NotImplementedError } from '@riftydev/io';
import { VfsError, asyncVfs } from '@riftydev/vfs';
import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';
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
  signal?: AbortSignal;
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

/**
 * Node validates the window SYNCHRONOUSLY at createReadStream with
 * ERR_OUT_OF_RANGE for negatives/non-integers. `highWaterMark: 0` is VALID in
 * Node (yields an empty stream + immediate 'end'; verified 2026-07-05) — it is
 * handled explicitly in `start()`, never forwarded to the VFS (whose
 * `chunkSize: 0` is a RangeError).
 */
function assertStreamRange(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw Object.assign(
      new RangeError(`The value of "${name}" is out of range. Received ${value}`),
      { code: 'ERR_OUT_OF_RANGE' },
    );
  }
}

function streamError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function statStrictOrNull(np: string): { isFile: boolean; isDirectory: boolean } | null {
  try {
    return syncMirror().statSync(np);
  } catch (err) {
    if (err instanceof VfsError && err.code === 'ENOENT') return null;
    throw err;
  }
}

const WRITE_AFTER_END = (): Error => streamError('ERR_STREAM_WRITE_AFTER_END', 'write after end');
const STREAM_DESTROYED = (): Error =>
  streamError('ERR_STREAM_DESTROYED', 'Cannot call write after a stream was destroyed');

function assertValidChunk(chunk: unknown): asserts chunk is string | Uint8Array {
  if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
    // Node throws SYNCHRONOUSLY — an invalid chunk is a programming error, and
    // the old array-like overlay of a function chunk minted a NUL byte into
    // the file (review 2026-07-05).
    throw Object.assign(
      new TypeError(
        'The "chunk" argument must be of type string or an instance of Buffer or Uint8Array',
      ),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
}

/**
 * Incremental bytes→string converter for the read-stream `encoding` option.
 * A chunk boundary must not split an encoding unit (Node routes through
 * StringDecoder): utf8 decodes via a streaming TextDecoder; utf16le/base64
 * carry the remainder to the next chunk; single-byte encodings pass through.
 */
class ChunkDecoder {
  private readonly enc: string;
  private readonly utf8: TextDecoder | null;
  private readonly unit: number;
  private carry: Uint8Array = new Uint8Array();

  constructor(enc: string) {
    this.enc = enc;
    const low = enc.toLowerCase();
    // Unknown encodings throw here (loud, synchronous — Node validates at
    // createReadStream too): probe the codec with an empty buffer.
    (Buffer.from(new Uint8Array()) as Uint8Array & { toString(e?: string): string }).toString(enc);
    this.utf8 = low === 'utf8' || low === 'utf-8' ? new TextDecoder('utf-8') : null;
    this.unit =
      low === 'utf16le' || low === 'utf-16le' || low === 'ucs2' || low === 'ucs-2'
        ? 2
        : low === 'base64' || low === 'base64url'
          ? 3
          : 1;
  }

  decode(bytes: Uint8Array): string {
    if (this.utf8) return this.utf8.decode(bytes, { stream: true });
    let buf = bytes;
    if (this.carry.length > 0) {
      const merged = new Uint8Array(this.carry.length + bytes.length);
      merged.set(this.carry, 0);
      merged.set(bytes, this.carry.length);
      buf = merged;
      this.carry = new Uint8Array();
    }
    const rem = this.unit === 1 ? 0 : buf.length % this.unit;
    if (rem > 0) {
      this.carry = buf.slice(buf.length - rem);
      buf = buf.subarray(0, buf.length - rem);
    }
    if (buf.length === 0) return '';
    return (Buffer.from(buf) as Uint8Array & { toString(e?: string): string }).toString(this.enc);
  }

  flush(): string {
    if (this.utf8) return this.utf8.decode();
    if (this.carry.length === 0) return '';
    const tail = this.carry;
    this.carry = new Uint8Array();
    return (Buffer.from(tail) as Uint8Array & { toString(e?: string): string }).toString(this.enc);
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
  private readonly emitCloseOpt: boolean;
  private readonly strDecoder: ChunkDecoder | null;
  private destroyed = false;
  private closeEmitted = false;

  constructor(path: string, opts: ReadStreamOptions = {}) {
    super();
    assertSupportedStreamOptions(opts, 'fs.createReadStream');
    if (opts.flags !== undefined && opts.flags !== 'r') {
      // Non-'r' read-stream flags change open side-effects we don't model.
      throw new NotImplementedError(`fs.createReadStream.flags:'${opts.flags}'`);
    }
    assertStreamRange('start', opts.start);
    assertStreamRange('end', opts.end);
    assertStreamRange('highWaterMark', opts.highWaterMark);
    if (opts.start !== undefined && opts.end !== undefined && opts.end < opts.start) {
      throw Object.assign(
        new RangeError(`The value of "start" is out of range. Received ${opts.start}`),
        { code: 'ERR_OUT_OF_RANGE' },
      );
    }
    this.emitCloseOpt = opts.emitClose ?? true;
    this.strDecoder = opts.encoding ? new ChunkDecoder(opts.encoding) : null;
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

  /** Emit 'close' at most once, honoring `emitClose:false` (Node parity). */
  private closeOnce(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    if (this.emitCloseOpt) this.emit('close');
  }

  private abort(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const err = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
      code: 'ABORT_ERR',
    });
    this.emit('error', err);
    this.closeOnce();
  }

  /** Node default: an errored stream still emits 'close' after 'error'. */
  private emitError(err: unknown): void {
    this.emit('error', toNodeFsError(err, 'open', this.path));
    this.closeOnce();
  }

  private emitData(bytes: Uint8Array): void {
    if (this.strDecoder) {
      // Never emit the empty string a mid-unit boundary produces.
      const text = this.strDecoder.decode(bytes);
      if (text !== '') this.emit('data', text);
    } else {
      this.emit('data', Buffer.from(bytes));
    }
  }

  /** Flush a decoder-held tail, then 'end' → 'close'. */
  private finishEnd(): void {
    const tail = this.strDecoder?.flush();
    if (tail) this.emit('data', tail);
    this.emit('end');
    this.closeOnce();
  }

  private start(): void {
    if (this.destroyed) return;
    const hwm = this.opts.highWaterMark ?? 64 * 1024;
    const np = resolvePath(this.path);
    // Node accepts highWaterMark 0: the stream opens, reads nothing and ends
    // immediately for an existing target, but still performs the open/stat
    // checks first (missing / path-through-file emit ENOENT / ENOTDIR).
    // The VFS chunkSize contract treats 0 as a RangeError, so short-circuit
    // only after the openability probe.
    if (hwm === 0) {
      try {
        syncMirror().statSync(np);
        this.emit('open', 0);
        this.emit('ready');
        this.finishEnd();
      } catch (err) {
        this.emitError(err);
      }
      return;
    }
    // Node's `createReadStream` byte range is INCLUSIVE of `end`; the half-open
    // `Vfs.openReadable` / sync-slice surfaces are exclusive — convert here so the
    // last byte is delivered (parity: {start,end} reads end-start+1 bytes).
    const exclusiveEnd = this.opts.end !== undefined ? this.opts.end + 1 : undefined;

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
          this.finishEnd();
          return;
        }
        const slice = data.subarray(i, Math.min(i + hwm, end));
        i += slice.length;
        this.emitData(slice);
        queueMicrotask(emitChunk);
      };
      this.emit('open', 0);
      this.emit('ready');
      emitChunk();
    };

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
              if (value && value.byteLength > 0) this.emitData(value);
            }
            this.finishEnd();
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
    if (this.destroyed) return;
    this.destroyed = true;
    // Async like Node's destroy teardown; closeOnce dedupes vs a prior end.
    queueMicrotask(() => this.closeOnce());
  }
}

interface PendingWrite {
  readonly buf: Uint8Array;
  readonly cb?: (err?: unknown) => void;
}

class FileWriteStream extends EventEmitter {
  readonly path: string;
  private readonly emitCloseOpt: boolean;
  private readonly flags: ParsedStreamFlags;
  private readonly highWaterMark: number;
  /** Resolved-at-open path — Node binds the fd at open; a later chdir must not retarget the file. */
  private np: string | null = null;
  /** Full file image; writes overlay at {@link pos} (r+ overwrites, a appends). */
  private bytes: Uint8Array = new Uint8Array();
  private pos = 0;
  /**
   * Chunks written BEFORE the open() microtask ran (Node buffers pre-open
   * writes). open() initialises {@link bytes}/{@link pos} from the file, THEN
   * overlays these — a plain write() here would be wiped by that init.
   */
  private preOpen: PendingWrite[] | null = [];
  private opened = false;
  private failed = false;
  private destroyed = false;
  private finished = false;
  private finishEmitted = false;
  private flushScheduled = false;
  private closeEmitted = false;
  private bufferedLength = 0;
  private needDrain = false;
  private destroyBeforeOpen = false;
  private emitDestroyError = false;
  private pendingErrorAfterOpen: unknown | null = null;
  private readonly pendingWriteCallbacks: Array<(err?: unknown) => void> = [];
  private readonly finishCallbacks: Array<(err?: unknown) => void> = [];

  constructor(path: string, opts: WriteStreamOptions = {}) {
    super();
    assertSupportedStreamOptions(opts, 'fs.createWriteStream', ['start', 'signal']);
    assertStreamRange('highWaterMark', opts.highWaterMark);
    this.flags = parseWriteFlags(opts.flags ?? 'w', 'fs.createWriteStream');
    this.emitCloseOpt = opts.emitClose ?? true;
    this.highWaterMark = opts.highWaterMark ?? 64 * 1024;
    this.path = path;
    keepaliveRef();
    setTimeout(() => {
      try {
        this.open();
      } finally {
        keepaliveUnref();
      }
    }, 0);
  }

  private closeOnce(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    if (this.emitCloseOpt) this.emit('close');
  }

  /**
   * Node's open side-effects happen at OPEN, not at end(): 'w' truncates the
   * file immediately, 'a' creates a missing file, exclusive flags raise
   * EEXIST, 'r+' requires existence. Failures are Node-shaped 'error' EVENTS.
   */
  private open(): void {
    if (this.destroyed && !this.destroyBeforeOpen) return;
    const np = resolvePath(this.path);
    this.np = np;
    let buffered: PendingWrite[] | null = null;
    try {
      const exists = statStrictOrNull(np) !== null;
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
      buffered = this.preOpen ?? [];
      this.preOpen = null;
      for (const write of buffered) this.overlay(write.buf);
      // Truncate/create at open even if nothing is ever written.
      syncMirror().writeFileSync(np, this.bytes);
      this.bufferedLength = 0;
      this.emit('open', 0);
      this.emit('ready');
      const destroyErr = this.destroyBeforeOpen ? STREAM_DESTROYED() : undefined;
      this.queueWriteCallbacks(buffered, destroyErr);
      this.emitDrainIfNeeded();
      if (this.destroyBeforeOpen) {
        this.queueFinishCallbacks(destroyErr);
        queueMicrotask(() => this.closeOnce());
        return;
      }
      if (this.pendingErrorAfterOpen) {
        const err = this.pendingErrorAfterOpen;
        this.pendingErrorAfterOpen = null;
        queueMicrotask(() => {
          this.emit('error', err);
          this.closeOnce();
        });
        return;
      }
      if (this.finished) queueMicrotask(() => this.finishIfReady());
    } catch (err) {
      if (this.pendingErrorAfterOpen) {
        const pendingErr = this.pendingErrorAfterOpen;
        this.pendingErrorAfterOpen = null;
        queueMicrotask(() => {
          this.emit('error', pendingErr);
          this.closeOnce();
        });
        return;
      }
      this.failed = true;
      const nodeErr = toNodeFsError(err, 'open', this.path);
      this.failPending(nodeErr, buffered ?? undefined);
      queueMicrotask(() => {
        this.emit('error', nodeErr);
        this.closeOnce();
      });
    }
  }

  private queueWriteCallbacks(writes: readonly PendingWrite[], err?: unknown): void {
    for (const write of writes) queueMicrotask(() => write.cb?.(err));
  }

  private queueCallbacks(callbacks: readonly ((err?: unknown) => void)[], err?: unknown): void {
    for (const cb of callbacks) queueMicrotask(() => cb(err));
  }

  private runPendingWriteCallbacks(err?: unknown): void {
    const callbacks = this.pendingWriteCallbacks.splice(0);
    for (const cb of callbacks) cb(err);
  }

  private failPending(err: unknown, pending?: PendingWrite[]): void {
    const buffered = pending ?? this.preOpen ?? [];
    this.preOpen = null;
    this.bufferedLength = 0;
    this.queueWriteCallbacks(buffered, err);
    this.queueCallbacks(this.pendingWriteCallbacks.splice(0), err);
    this.queueFinishCallbacks(err);
  }

  private queueFinishCallbacks(err?: unknown): void {
    const callbacks = this.finishCallbacks.splice(0);
    for (const cb of callbacks) queueMicrotask(() => cb(err));
  }

  private runFinishCallbacks(err?: unknown): void {
    const callbacks = this.finishCallbacks.splice(0);
    for (const cb of callbacks) cb(err);
  }

  write(
    chunk: unknown,
    encodingOrCb?: string | ((err?: unknown) => void),
    maybeCb?: (err?: unknown) => void,
  ): boolean {
    // Node overload: write(chunk, cb).
    const cb = typeof encodingOrCb === 'function' ? encodingOrCb : maybeCb;
    const encoding = typeof encodingOrCb === 'function' ? undefined : encodingOrCb;
    assertValidChunk(chunk);
    if (this.finished) {
      const err = WRITE_AFTER_END();
      const shouldErrorStream = !this.finishEmitted && !this.failed && !this.destroyed;
      const deferErrorUntilOpen = !this.opened && shouldErrorStream;
      const buffered = deferErrorUntilOpen ? (this.preOpen ?? []) : [];
      const pendingWriteCallbacks = shouldErrorStream ? this.pendingWriteCallbacks.splice(0) : [];
      if (shouldErrorStream) {
        if (this.opened) this.persist();
        // A same-turn write-after-end destroys before 'finish'. If the file is
        // not open yet, open still applies its create/truncate side effect, but
        // buffered writes are discarded (Node parity).
        this.preOpen = null;
        this.failed = true;
        if (deferErrorUntilOpen) this.pendingErrorAfterOpen = err;
      }
      queueMicrotask(() => {
        cb?.(err);
      });
      if (shouldErrorStream) {
        this.queueCallbacks(pendingWriteCallbacks, STREAM_DESTROYED());
        this.queueWriteCallbacks(buffered, err);
        this.queueFinishCallbacks(err);
        if (!deferErrorUntilOpen) {
          queueMicrotask(() => {
            this.emit('error', err);
            this.closeOnce();
          });
        }
      }
      return false;
    }
    if (this.failed || this.destroyed) {
      // Node: callback only — no 'error' event (verified 2026-07-05).
      const err = STREAM_DESTROYED();
      queueMicrotask(() => cb?.(err));
      return false;
    }
    const buf =
      typeof chunk === 'string' ? Buffer.from(chunk, (encoding ?? 'utf8') as never) : chunk;
    this.bufferedLength += buf.byteLength;
    const overHighWaterMark = this.bufferedLength >= this.highWaterMark;
    if (overHighWaterMark) this.needDrain = true;
    if (this.preOpen !== null) {
      // Not yet open: buffer; open() overlays these onto the file image.
      this.preOpen.push({ buf, cb });
    } else {
      this.overlay(buf);
      if (cb) this.pendingWriteCallbacks.push(cb);
      this.scheduleFlush();
    }
    return !overHighWaterMark;
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
      const err = this.persist();
      if (err) {
        this.runPendingWriteCallbacks(err);
      } else if (!this.failed) {
        this.bufferedLength = 0;
        this.runPendingWriteCallbacks();
        this.emitDrainIfNeeded();
      }
    });
  }

  private persist(): unknown | null {
    // np bound at open (Node binds the fd there): persist never re-resolves,
    // so a chdir mid-stream cannot retarget the file (review 2026-07-05).
    const np = this.np;
    if (np === null) return null;
    try {
      syncMirror().writeFileSync(np, this.bytes);
      return null;
    } catch (err) {
      this.failed = true;
      const nodeErr = toNodeFsError(err, 'write', this.path);
      this.emit('error', nodeErr);
      this.closeOnce();
      return nodeErr;
    }
  }

  private emitDrainIfNeeded(): void {
    if (!this.needDrain || this.destroyed || this.failed) return;
    this.needDrain = false;
    queueMicrotask(() => {
      if (!this.destroyed && !this.failed) this.emit('drain');
    });
  }

  private finishIfReady(): void {
    if (!this.opened || this.failed || this.destroyed || this.finishEmitted) return;
    this.finishEmitted = true;
    const err = this.persist();
    if (err) {
      this.runFinishCallbacks(err);
      return;
    }
    this.runFinishCallbacks();
    this.emit('finish');
    this.closeOnce();
  }

  end(
    chunkOrCb?: unknown,
    encodingOrCb?: string | ((err?: unknown) => void),
    maybeCb?: (err?: unknown) => void,
  ): void {
    // Node overloads: end(cb), end(chunk, cb), end(chunk, encoding, cb).
    const chunk = typeof chunkOrCb === 'function' ? undefined : chunkOrCb;
    const cb =
      typeof chunkOrCb === 'function'
        ? (chunkOrCb as (err?: unknown) => void)
        : typeof encodingOrCb === 'function'
          ? encodingOrCb
          : maybeCb;
    const encoding = typeof encodingOrCb === 'function' ? undefined : encodingOrCb;
    if (this.finished) {
      // Node: a second end() still fires its callback, with no error (verified
      // 2026-07-05); the write path already emitted 'error' for any chunk.
      if (chunk !== undefined) this.write(chunk, encoding as string | undefined);
      queueMicrotask(() => cb?.());
      return;
    }
    if (this.destroyed) return; // Node: end() on a destroyed stream drops the callback (verified)
    if (chunk !== undefined) this.write(chunk, encoding as string | undefined);
    this.finished = true;
    if (cb) this.finishCallbacks.push(cb);
    queueMicrotask(() => this.finishIfReady());
  }

  /** Node semantics: destroy discards buffered-but-unflushed data, no 'finish'. */
  destroy(): void {
    if (this.destroyed) return;
    const err = STREAM_DESTROYED();
    const preOpen = !this.opened;
    const buffered = this.preOpen ?? [];
    const hadPendingWriteCallbacks = this.pendingWriteCallbacks.length > 0;
    this.preOpen = null;
    this.queueWriteCallbacks(buffered, err);
    this.queueCallbacks(this.pendingWriteCallbacks.splice(0), err);
    this.queueFinishCallbacks(err);
    this.destroyBeforeOpen = preOpen;
    this.emitDestroyError = !preOpen && hadPendingWriteCallbacks;
    this.destroyed = true;
    if (preOpen) return;
    queueMicrotask(() => {
      if (this.emitDestroyError) this.emit('error', err);
      this.closeOnce();
    });
  }
}

export function createReadStream(path: string, opts?: ReadStreamOptions): FileReadStream {
  return new FileReadStream(path, opts);
}

export function createWriteStream(path: string, opts?: WriteStreamOptions): FileWriteStream {
  return new FileWriteStream(path, opts);
}

export { FileReadStream, FileWriteStream };
