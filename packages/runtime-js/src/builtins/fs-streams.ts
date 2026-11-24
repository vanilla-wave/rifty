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
import {
  type ParsedStreamFlags,
  type ReadStreamOptions,
  type WriteStreamOptions,
  assertStreamRange,
  assertSupportedStreamOptions,
  assertValidChunk,
  chunkBytes,
  normalizeStreamOptions,
  parseWriteFlags,
} from './fs-stream-options.ts';
import { syncMirror } from './fs-sync-mirror.ts';

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
const ALREADY_FINISHED = (): Error =>
  streamError('ERR_STREAM_ALREADY_FINISHED', 'Stream is already finished');
const PREMATURE_CLOSE = (): Error => streamError('ERR_STREAM_PREMATURE_CLOSE', 'Premature close');

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
    // Unknown encodings throw here (loud, sync, as Node's createReadStream).
    (Buffer.from(new Uint8Array()) as Uint8Array & { toString(e?: string): string }).toString(enc);
    const utf8 = low === 'utf8' || low === 'utf-8';
    this.utf8 = utf8 ? new TextDecoder('utf-8', { ignoreBOM: true }) : null; // Node keeps BOM
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

class FileReadStream extends EventEmitter {
  readonly path: string;
  private readonly opts: ReadStreamOptions;
  private readonly emitCloseOpt: boolean;
  private readonly strDecoder: ChunkDecoder | null;
  /** Node's `destroyed`: destroy()/close()/abort/error, and autoDestroy after 'end'. */
  destroyed = false;
  private ended = false;
  private openEmitted = false;
  /** destroy() before open: Node completes the open ('open'/'ready' fire) and only THEN closes. */
  private closeAfterOpen = false;
  private closeEmitted = false;
  /** Node's `closed`: true from teardown, before 'error' and 'close' fire (even with emitClose:false). */
  private closedState = false;
  /** The emitted 'error' — Node's `errored`, read by close(cb). */
  private erroredWith: unknown = null;

  constructor(path: string, optsOrEncoding: ReadStreamOptions | string | null = {}) {
    super();
    const opts = normalizeStreamOptions<ReadStreamOptions>(optsOrEncoding);
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

  get closed(): boolean {
    return this.closedState;
  }

  /** Emit 'close' at most once, honoring `emitClose:false` (Node parity). */
  private closeOnce(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.closedState = true;
    if (this.emitCloseOpt) this.emit('close');
  }

  /** Node default: an errored stream still emits 'close' after 'error'. */
  private errorThenClose(err: unknown): void {
    this.destroyed = true; // terminal — a later signal abort must not double-error
    this.closedState = true;
    this.erroredWith = err;
    this.emit('error', err);
    this.closeOnce();
  }

  private abort(): void {
    // Post-'end' abort is a no-op in Node — the stream already finished.
    if (this.destroyed || this.ended) return;
    this.errorThenClose(
      Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
        code: 'ABORT_ERR',
      }),
    );
  }

  private emitError(err: unknown, syscall: 'open' | 'read' = 'open'): void {
    this.errorThenClose(toNodeFsError(err, syscall, this.path));
  }

  /** 'open' → 'ready', plus the deferred 'close' a pre-open destroy() parked. */
  private emitOpenReady(): void {
    this.openEmitted = true;
    this.emit('open', 0);
    this.emit('ready');
    if (this.closeAfterOpen) {
      this.closeAfterOpen = false;
      this.closeOnce();
    }
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
    this.ended = true;
    this.emit('end');
    this.destroyed = true; // Node autoDestroy, after the 'end' listeners
    this.closeOnce();
  }

  private start(): void {
    const hwm = this.opts.highWaterMark ?? 64 * 1024;
    const np = resolvePath(this.path);
    if (this.destroyed) {
      // Aborted or destroy()ed before open: Node still completes the open —
      // 'open'/'ready' fire when it succeeds (after the abort's error|close;
      // before destroy()'s deferred close).
      try {
        syncMirror().statSync(np);
        this.emitOpenReady();
      } catch (err) {
        this.openFailedAfterDestroy(err);
      }
      return;
    }
    // Node accepts highWaterMark 0: the stream opens, reads nothing and ends
    // immediately for an existing target, but still performs the open/stat
    // checks first (missing / path-through-file emit ENOENT / ENOTDIR).
    // The VFS chunkSize contract treats 0 as a RangeError, so short-circuit
    // only after the openability probe.
    if (hwm === 0) {
      try {
        syncMirror().statSync(np);
        this.emitOpenReady();
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
    let openedStat: { isDirectory: boolean };
    try {
      openedStat = syncMirror().statSync(np);
    } catch (err) {
      this.emitError(err);
      return;
    }
    if (openedStat.isDirectory) {
      this.emitOpenReady();
      // The read fails a step after 'ready' (Node: a separate I/O turn), so a
      // close()/destroy() issued after 'ready' wins.
      queueMicrotask(() => {
        if (!this.destroyed) this.emitError(new VfsError('EISDIR', np), 'read');
      });
      return;
    }

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
      // First chunk a step after 'ready', as every later one: a close()/destroy()
      // issued after 'ready' stops the read before any 'data' (Node).
      queueMicrotask(emitChunk);
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
            // Aborted/destroyed while the open was in flight: the open still
            // COMPLETED — emit 'open'/'ready' (Node), just never read.
            this.emitOpenReady();
            await stream.cancel().catch(() => {});
            return;
          }
          this.emitOpenReady();
          const reader = stream.getReader();
          try {
            while (true) {
              if (this.destroyed) {
                await reader.cancel().catch(() => {});
                return;
              }
              const { value, done } = await reader.read();
              // A close()/destroy() while the read was in flight wins: no
              // 'data' or 'end' after it (Node).
              if (this.destroyed) {
                await reader.cancel().catch(() => {});
                return;
              }
              if (done) break;
              if (value && value.byteLength > 0) this.emitData(value);
            }
            this.finishEnd();
          } catch (err) {
            if (this.destroyed) {
              // Read failure racing an abort/destroy — swallowed like Node.
              this.closeOnce();
              return;
            }
            this.emitError(err, 'read');
          }
        })
        .catch((err) => {
          if (this.destroyed) this.openFailedAfterDestroy(err);
          else this.emitError(err);
        });
      return;
    }

    // No async surface: serve from the sync mirror, still chunked over
    // microtasks to preserve stream event order.
    try {
      this.emitOpenReady();
      if (this.destroyed) return;
      emitFromBytes(syncMirror().readFileBytesSync(np));
    } catch (err) {
      this.emitError(err, 'read');
    }
  }

  /**
   * Open failure after a pre-open destroy()/abort: Node surfaces it unless the
   * stream already errored — a pre-aborted missing file shows only the abort
   * error, a destroy()ed one its ENOENT (probed v24).
   */
  private openFailedAfterDestroy(err: unknown): void {
    this.closeAfterOpen = false;
    if (this.erroredWith === null) this.emitError(err);
    else this.closeOnce();
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
    if (!this.openEmitted && !this.ended) {
      // Pre-open destroy: Node finishes the open first — open|ready|close
      // (probed v24). start()/the open continuation emits the parked close.
      this.closeAfterOpen = true;
      return;
    }
    // Async like Node's destroy teardown; closeOnce dedupes vs a prior end.
    queueMicrotask(() => this.closeOnce());
  }

  /**
   * Node: `finished(this, cb)` then `destroy()`. The callback follows Node's
   * end-of-stream rules: the error if the stream errors (on 'error'), else on
   * 'close' — no arguments after 'end', ERR_STREAM_PREMATURE_CLOSE before it;
   * with `emitClose:false` and nothing left to wait for, a tick later; never
   * when nothing settles it (emitClose:false, closed before 'end').
   */
  close(cb?: unknown): void {
    if (typeof cb === 'function')
      this.onFinished(cb as (this: FileReadStream, err?: unknown) => void);
    this.destroy();
  }

  private onFinished(cb: (this: FileReadStream, err?: unknown) => void): void {
    let called = false;
    const call = (...args: [] | [unknown]): void => {
      if (called) return;
      called = true;
      cb.apply(this, args);
    };
    const onClose = (): void => {
      if (this.erroredWith !== null) call(this.erroredWith);
      else if (!this.ended) call(PREMATURE_CLOSE());
      else call();
    };
    if (this.closedState) {
      queueMicrotask(onClose);
      return;
    }
    // emitClose:false with nothing left to wait for: Node's `onclosed` a tick
    // later — the error if any, else no arguments (no premature-close check).
    if (!this.emitCloseOpt && (this.erroredWith !== null || this.ended || this.destroyed)) {
      queueMicrotask(() => (this.erroredWith !== null ? call(this.erroredWith) : call()));
      return;
    }
    this.on('error', (err) => call(err));
    this.on('close', onClose);
  }
}

interface PendingWrite {
  readonly buf: Uint8Array;
  readonly cb?: (err?: unknown) => void;
}

class FileWriteStream extends EventEmitter {
  /** Prototype alias of end() (below the class), as Node. */
  declare destroySoon: FileWriteStream['end'];
  readonly path: string;
  private readonly emitCloseOpt: boolean;
  private readonly flags: ParsedStreamFlags;
  private readonly highWaterMark: number;
  private readonly defaultEncoding: string;
  /** True while open() runs — Node's write-dispatch boundary (see destroy). */
  private openTurn = false;
  /** Resolved-at-open path — Node binds the fd at open; a later chdir must not retarget the file. */
  private np: string | null = null;
  /** Full file image for positional writes; append streams re-read EOF at flush. */
  private bytes: Uint8Array = new Uint8Array();
  private pos = 0;
  private appendChunks: Uint8Array[] = [];
  private dirty = false;
  /**
   * Chunks written BEFORE the open() microtask ran (Node buffers pre-open
   * writes). open() initialises {@link bytes}/{@link pos} from the file, THEN
   * overlays these — a plain write() here would be wiped by that init.
   */
  private preOpen: PendingWrite[] | null = [];
  private opened = false;
  private failed = false;
  private destroyCalled = false;
  /** Node autoDestroy after 'finish' listeners. */
  private autoDestroyed = false;
  /** Node's `closed`: true from teardown, before 'error' and 'close' fire. */
  private closedState = false;
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

  constructor(path: string, optsOrEncoding: WriteStreamOptions | string | null = {}) {
    super();
    const opts = normalizeStreamOptions<WriteStreamOptions>(optsOrEncoding);
    assertSupportedStreamOptions(opts, 'fs.createWriteStream', ['start', 'signal']);
    assertStreamRange('highWaterMark', opts.highWaterMark);
    this.flags = parseWriteFlags(opts.flags ?? 'w', 'fs.createWriteStream');
    this.emitCloseOpt = opts.emitClose ?? true;
    this.highWaterMark = opts.highWaterMark ?? 64 * 1024;
    // Node: the stream-level encoding is the DEFAULT for string writes —
    // `createWriteStream(p, 'base64')` decodes write('aGk=') as base64
    // (per-write encoding still overrides; probed v24).
    this.defaultEncoding = opts.encoding ?? 'utf8';
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

  /** Node's `destroyed`: destroy(), any error, or autoDestroy after 'finish'. */
  get destroyed(): boolean {
    return this.destroyCalled || this.failed || this.autoDestroyed;
  }

  get closed(): boolean {
    return this.closedState;
  }

  private closeOnce(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.closedState = true;
    if (this.emitCloseOpt) this.emit('close');
  }

  /** Node default: an errored stream still emits 'close' after 'error'. */
  private errorThenClose(err: unknown): void {
    this.closedState = true;
    this.emit('error', err);
    this.closeOnce();
  }

  /**
   * Node's open side-effects happen at OPEN, not at end(): 'w' truncates the
   * file immediately, 'a' creates a missing file, exclusive flags raise
   * EEXIST, 'r+' requires existence. Failures are Node-shaped 'error' EVENTS.
   */
  private open(): void {
    if (this.destroyCalled && !this.destroyBeforeOpen) return;
    const np = resolvePath(this.path);
    this.np = np;
    let buffered: PendingWrite[] | null = null;
    // Node's write-dispatch boundary: writes issued synchronously DURING the
    // open-completion turn (e.g. inside the 'ready' handler) are not yet
    // dispatched — a destroy() in that window discards them without an
    // 'error' (probed v24; see destroy()).
    this.openTurn = true;
    try {
      const stat = statStrictOrNull(np);
      const exists = stat !== null;
      if (exists && this.flags.exclusive) {
        throw fsError('EEXIST', pathToString(this.path), 'open');
      }
      if (stat?.isDirectory) {
        throw fsError('EISDIR', pathToString(this.path), 'open');
      }
      if (!exists && this.flags.mustExist) {
        throw fsError('ENOENT', pathToString(this.path), 'open');
      }
      this.bytes =
        exists && !this.flags.truncate && !this.flags.append
          ? syncMirror().readFileBytesSync(np).slice()
          : new Uint8Array();
      this.pos = 0;
      this.opened = true;
      buffered = this.preOpen ?? [];
      this.preOpen = null;
      for (const write of buffered) this.recordWrite(write.buf);
      // Node open side-effects: 'w' truncates immediately, missing writable
      // targets are created immediately, but append/r+ on an existing file do
      // not rewrite the file before the first write.
      if (this.flags.truncate || !exists) {
        syncMirror().writeFileSync(np, new Uint8Array());
      }
      this.bufferedLength = 0;
      this.emit('open', 0);
      this.emit('ready');
      const destroyErr = this.destroyBeforeOpen ? STREAM_DESTROYED() : undefined;
      if (this.destroyBeforeOpen) {
        this.queueWriteCallbacks(buffered, destroyErr);
        this.queueFinishCallbacks(destroyErr);
        queueMicrotask(() => this.closeOnce());
        return;
      }
      if (this.pendingErrorAfterOpen) {
        const err = this.pendingErrorAfterOpen;
        this.pendingErrorAfterOpen = null;
        queueMicrotask(() => {
          this.errorThenClose(err);
        });
        return;
      }
      const bufferedErr = buffered.length > 0 ? this.persist() : null;
      this.queueWriteCallbacks(buffered, bufferedErr ?? undefined);
      if (bufferedErr !== null) {
        this.queueFinishCallbacks(bufferedErr);
        return;
      }
      this.emitDrainIfNeeded();
      if (this.finished) queueMicrotask(() => this.finishIfReady());
    } catch (err) {
      if (this.pendingErrorAfterOpen) {
        const pendingErr = this.pendingErrorAfterOpen;
        this.pendingErrorAfterOpen = null;
        queueMicrotask(() => {
          this.errorThenClose(pendingErr);
        });
        return;
      }
      this.failed = true;
      const nodeErr = toNodeFsError(err, 'open', this.path);
      this.failPending(nodeErr, buffered ?? undefined);
      queueMicrotask(() => {
        this.errorThenClose(nodeErr);
      });
    } finally {
      this.openTurn = false;
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
      const shouldErrorStream = !this.finishEmitted && !this.failed && !this.destroyCalled;
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
            this.errorThenClose(err);
          });
        }
      }
      return false;
    }
    if (this.failed || this.destroyCalled) {
      // Node: callback only — no 'error' event (verified 2026-07-05).
      const err = STREAM_DESTROYED();
      queueMicrotask(() => cb?.(err));
      return false;
    }
    const buf =
      typeof chunk === 'string'
        ? Buffer.from(chunk, (encoding ?? this.defaultEncoding) as never)
        : chunkBytes(chunk);
    this.bufferedLength += buf.byteLength;
    const overHighWaterMark = this.bufferedLength >= this.highWaterMark;
    if (overHighWaterMark) this.needDrain = true;
    if (this.preOpen !== null) {
      // Not yet open: buffer; open() overlays these onto the file image.
      this.preOpen.push({ buf, cb });
    } else {
      this.recordWrite(buf);
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

  private recordWrite(buf: Uint8Array): void {
    if (this.flags.append) {
      this.appendChunks.push(buf.slice());
      return;
    }
    this.overlay(buf);
    this.dirty = true;
  }

  private flushAppendChunks(np: string): void {
    if (this.appendChunks.length === 0) return;
    const current = syncMirror().readFileBytesSync(np);
    const total = current.length + this.appendChunks.reduce((n, chunk) => n + chunk.length, 0);
    const next = new Uint8Array(total);
    next.set(current, 0);
    let offset = current.length;
    for (const chunk of this.appendChunks) {
      next.set(chunk, offset);
      offset += chunk.length;
    }
    syncMirror().writeFileSync(np, next);
    this.appendChunks = [];
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
      if (this.failed || this.destroyCalled) return;
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
      if (this.flags.append) this.flushAppendChunks(np);
      else if (this.dirty) {
        syncMirror().writeFileSync(np, this.bytes);
        this.dirty = false;
      }
      return null;
    } catch (err) {
      this.failed = true;
      const nodeErr = toNodeFsError(err, 'write', this.path);
      this.errorThenClose(nodeErr);
      return nodeErr;
    }
  }

  private emitDrainIfNeeded(): void {
    // Node's afterWrite: no 'drain' once end()/close() began ending the stream.
    if (!this.needDrain || this.destroyCalled || this.failed || this.finished) return;
    this.needDrain = false;
    queueMicrotask(() => {
      if (!this.destroyCalled && !this.failed && !this.finished) this.emit('drain');
    });
  }

  private finishIfReady(): void {
    if (!this.opened || this.failed || this.destroyCalled || this.finishEmitted) return;
    this.finishEmitted = true;
    const err = this.persist();
    if (err) {
      this.runFinishCallbacks(err);
      return;
    }
    this.runFinishCallbacks();
    this.emit('finish');
    this.autoDestroyed = true; // Node autoDestroy, after the 'finish' listeners
    this.closeOnce();
  }

  end(
    chunkOrCb?: unknown,
    encodingOrCb?: string | ((err?: unknown) => void),
    maybeCb?: (err?: unknown) => void,
  ): this {
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
      if (chunk !== undefined) {
        this.endAfterEnd(chunk, cb);
        return this;
      }
      if (this.finishEmitted) {
        // Node (probed v24): chunkless end() AFTER 'finish' errors the
        // callback with ERR_STREAM_ALREADY_FINISHED — no 'error' event.
        const err = ALREADY_FINISHED();
        queueMicrotask(() => cb?.(err));
        return this;
      }
      // Same-tick second end(): the callback rides the pending finish, clean.
      if (cb) this.finishCallbacks.push(cb);
      return this;
    }
    if (this.destroyCalled) return this; // Node: end() on a destroyed stream drops the callback (verified)
    if (chunk !== undefined) this.write(chunk, encoding as string | undefined);
    this.finished = true;
    if (cb) this.finishCallbacks.push(cb);
    queueMicrotask(() => this.finishIfReady());
    return this;
  }

  /**
   * Second end() WITH a chunk (probed v24, handoff #5): every callback —
   * this one, the first end()'s, buffered writes' — gets
   * ERR_STREAM_WRITE_AFTER_END, and pre-'finish' the stream errors too.
   * Post-open the first chunk's in-flight write still COMPLETES (Node keeps
   * it, same as write-after-end) and this cb errors before the first end's;
   * pre-open the buffered writes are DISCARDED (Node leaves the file empty)
   * and the callbacks error in registration order once open settles.
   * Post-'finish' it is callback-only and the file stays as finished.
   */
  private endAfterEnd(chunk: unknown, cb?: (err?: unknown) => void): void {
    assertValidChunk(chunk);
    const err = WRITE_AFTER_END();
    if (this.finishEmitted || this.failed || this.destroyCalled) {
      queueMicrotask(() => cb?.(err));
      return;
    }
    if (this.opened) {
      this.persist();
      this.failed = true;
      const pendingCbs = this.pendingWriteCallbacks.splice(0);
      queueMicrotask(() => cb?.(err));
      this.queueCallbacks(pendingCbs, STREAM_DESTROYED());
      this.queueFinishCallbacks(err);
      queueMicrotask(() => {
        this.errorThenClose(err);
      });
      return;
    }
    const buffered = this.preOpen ?? [];
    this.preOpen = null;
    this.bufferedLength = 0;
    this.failed = true; // blocks the queued flush and finishIfReady persists
    this.pendingErrorAfterOpen = err;
    this.queueCallbacks(this.pendingWriteCallbacks.splice(0), STREAM_DESTROYED());
    this.queueWriteCallbacks(buffered, err);
    this.queueFinishCallbacks(err);
    queueMicrotask(() => cb?.(err));
  }

  /**
   * Node's destroy() truth sits on the write-DISPATCH boundary (probed v24;
   * parity fs/write-stream-destroy-events): writes buffered pre-open or
   * synchronously during the open-completion turn are DISCARDED — callbacks
   * get ERR_STREAM_DESTROYED, the file is untouched, NO 'error' event. A
   * burst recorded after that turn is IN FLIGHT: its bytes LAND in the file,
   * the callbacks still error, and the stream emits 'error'. An idle stream
   * (everything flushed) closes silently. The old rule emitted 'error' for
   * any post-open pending callback — `ws.write(data, cb); ws.destroy()`
   * inside 'ready' CRASHED consumers via the no-listener 'error' throw, and
   * `end(chunk); destroy()` after ready missed the 'error' Node does emit.
   * No 'finish' in any branch.
   */
  destroy(): void {
    if (this.destroyCalled) return;
    const err = STREAM_DESTROYED();
    const preOpen = !this.opened;
    const preDispatch = preOpen || this.openTurn;
    const inFlight = !preDispatch && this.flushScheduled;
    // Let the in-flight burst land like Node's kernel write does. persist()
    // failure surfaces ITS error itself — don't stack the destroyed one.
    const persistErr = inFlight ? this.persist() : null;
    const buffered = this.preOpen ?? [];
    this.preOpen = null;
    this.queueWriteCallbacks(buffered, err);
    this.queueCallbacks(this.pendingWriteCallbacks.splice(0), err);
    this.queueFinishCallbacks(err);
    this.destroyBeforeOpen = preOpen;
    this.emitDestroyError = inFlight && persistErr === null;
    this.destroyCalled = true;
    if (preOpen) return;
    queueMicrotask(() => {
      if (this.emitDestroyError) this.errorThenClose(err);
      else this.closeOnce();
    });
  }

  /**
   * Node: a truthy cb rides 'close' (a tick later if already closed; never
   * with emitClose:false before close), then end(): pending writes land,
   * 'finish' → 'close'. A non-function cb throws from on().
   */
  close(cb?: unknown): void {
    if (cb) {
      if (this.closedState) {
        queueMicrotask(() => (cb as () => void)());
        return;
      }
      this.on('close', cb as () => void);
    }
    this.end();
  }
}

export function createReadStream(
  path: string,
  opts?: ReadStreamOptions | string | null,
): FileReadStream {
  return new FileReadStream(path, opts ?? {});
}

export function createWriteStream(
  path: string,
  opts?: WriteStreamOptions | string | null,
): FileWriteStream {
  return new FileWriteStream(path, opts ?? {});
}

// Node: `WriteStream.prototype.destroySoon = WriteStream.prototype.end`.
FileWriteStream.prototype.destroySoon = FileWriteStream.prototype.end;

export { FileReadStream, FileWriteStream };
