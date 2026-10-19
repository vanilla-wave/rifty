import type { KernelStdioInputReader } from '@riftydev/kernel';
import { NotImplementedError } from '@riftydev/vfs';
import { ref as refEventLoop, unref as unrefEventLoop } from '../internal/event-loop-keepalive.ts';
import { EventEmitter } from './events.ts';
import { INHERIT_STDIN, type InheritStdin, type StdinInheritor } from './process-stdin-inherit.ts';
import { STDIN_FD, type StdinFdSource } from './stdio-fd-source.ts';

export interface NodeStdin extends EventEmitter {
  isTTY: boolean;
  fd: number;
  setEncoding(encoding?: string | null): NodeStdin;
  resume(): NodeStdin;
  pause(): NodeStdin;
  read(size?: number): never;
  pipe(destination: unknown): never;
  setRawMode(enabled: boolean): never;
  [Symbol.asyncIterator](): never;
}

type StdinListener = (...args: unknown[]) => void;

function throwStdinGap(feature: string): never {
  throw new NotImplementedError(feature);
}

/** Runtime-owned loud boundary shared by every spec-seeded and host process. */
class NodeStdinEmitter extends EventEmitter implements NodeStdin {
  readonly #onDataListener: () => void;

  declare isTTY: boolean;
  declare fd: number;
  declare setEncoding: NodeStdin['setEncoding'];
  declare resume: NodeStdin['resume'];
  declare pause: NodeStdin['pause'];

  constructor(onDataListener: () => void) {
    super();
    this.#onDataListener = onDataListener;
  }

  override addListener(event: string | symbol, listener: StdinListener): this {
    if (event === 'readable') throwStdinGap('process.stdin.readable');
    const result = super.addListener(event, listener);
    if (event === 'data') this.#onDataListener();
    return result;
  }

  override prependListener(event: string | symbol, listener: StdinListener): this {
    if (event === 'readable') throwStdinGap('process.stdin.readable');
    const result = super.prependListener(event, listener);
    if (event === 'data') this.#onDataListener();
    return result;
  }

  read(): never {
    return throwStdinGap('process.stdin.read');
  }

  pipe(): never {
    return throwStdinGap('process.stdin.pipe');
  }

  setRawMode(): never {
    return throwStdinGap('process.stdin.setRawMode');
  }

  [Symbol.asyncIterator](): never {
    return throwStdinGap('process.stdin[Symbol.asyncIterator]');
  }
}

/**
 * Build a `process.stdin` Readable-ish EventEmitter fed by either a kernel
 * stdin MessagePort (spec child) or the host bridge (`writeProcessStdin`, REPL).
 * Returns the stdin + a `push(data)` the host source calls. Pre-listener
 * buffering + utf8 stream-decoding match Node's encoding semantics.
 */
export function makeStdinReader(
  port?: MessagePort,
  isTTY = false,
  input?: KernelStdioInputReader,
): {
  stdin: NodeStdin;
  push(data: string | Uint8Array): void;
} {
  let encoding: string | null = null;
  const pending: Array<string | Uint8Array> = [];
  let decoder = new TextDecoder();
  let flowing = false;
  let explicitlyPaused = false;
  let eofReceived = false;
  let endEmitted = false;
  let keepaliveHeld = false;
  let closed = false;
  const reads: Array<{
    length: number;
    callback: (error: Error | null, bytes?: Uint8Array) => void;
  }> = [];
  const badFd = () => Object.assign(new Error('bad file descriptor'), { code: 'EBADF' });
  // Worker children reading this stdin as an inherited fd (never holds the realm).
  const inheritors = new Set<StdinInheritor>();
  const syncKeepalive = (): void => {
    const shouldHold =
      port !== undefined && (flowing || reads.length > 0) && !eofReceived && !closed;
    if (shouldHold === keepaliveHeld) return;
    keepaliveHeld = shouldHold;
    if (shouldHold) refEventLoop();
    else unrefEventLoop();
  };
  const stdin = new NodeStdinEmitter(() => {
    if (explicitlyPaused) return;
    flowing = true;
    syncKeepalive();
    queueMicrotask(pump);
  });

  const normalize = (data: string | Uint8Array): string | Uint8Array | null => {
    if (typeof data === 'string') return data;
    if (encoding && /^utf-?8$/iu.test(encoding)) {
      const text = decoder.decode(data, { stream: true });
      return text.length === 0 ? null : text;
    }
    return data;
  };
  function take(length: number): Uint8Array {
    const chunk = pending.shift();
    if (chunk === undefined) return new Uint8Array();
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    const count = Math.min(length, bytes.length);
    if (count < bytes.length) pending.unshift(bytes.subarray(count));
    return bytes.slice(0, count);
  }
  function flush(): void {
    while (reads.length > 0 && (pending.length > 0 || eofReceived)) {
      const request = reads.shift()!;
      const bytes = take(request.length);
      queueMicrotask(() => request.callback(null, bytes));
    }
    syncKeepalive();
    while ((flowing || inheritors.size > 0) && pending.length > 0) {
      const data = pending.shift();
      if (data === undefined) continue;
      for (const inheritor of inheritors) inheritor.data(data);
      if (!flowing) continue;
      const chunk = normalize(data);
      if (chunk !== null) stdin.emit('data', chunk);
    }
    if (eofReceived && pending.length === 0) {
      for (const inheritor of inheritors) inheritor.end();
      inheritors.clear();
    }
    if (!flowing || pending.length > 0 || !eofReceived || endEmitted) return;
    if (encoding && /^utf-?8$/iu.test(encoding)) {
      const tail = decoder.decode();
      if (tail.length > 0) stdin.emit('data', tail);
    }
    endEmitted = true;
    stdin.emit('end');
  }
  function pump(): void {
    flush();
    if (!input || closed || eofReceived) return;
    while (flowing || inheritors.size > 0 || reads.length > 0) {
      const bytes = input.read(64 * 1024, false);
      if (bytes === null) break;
      if (bytes.length === 0) {
        end();
        break;
      }
      pending.push(bytes);
      flush();
    }
  }
  const push = (data: string | Uint8Array): void => {
    if (eofReceived) return;
    pending.push(data);
    flush();
  };
  const end = (): void => {
    if (eofReceived) return;
    eofReceived = true;
    syncKeepalive();
    flush();
  };

  Object.assign(stdin, {
    isTTY,
    fd: 0,
    setEncoding(next: string | null) {
      const requested = next ?? 'utf8';
      if (!/^utf-?8$/iu.test(requested)) {
        throw new NotImplementedError(`process.stdin.setEncoding('${requested}')`);
      }
      if (encoding === 'utf8') return stdin;
      encoding = 'utf8';
      decoder = new TextDecoder();
      return stdin;
    },
    resume() {
      explicitlyPaused = false;
      flowing = true;
      syncKeepalive();
      pump();
      return stdin;
    },
    pause() {
      explicitlyPaused = true;
      flowing = false;
      syncKeepalive();
      return stdin;
    },
  });
  const inherit: InheritStdin = (inheritor) => {
    inheritors.add(inheritor);
    queueMicrotask(pump);
    return () => inheritors.delete(inheritor);
  };
  Object.defineProperty(stdin, INHERIT_STDIN, { value: inherit });
  const fd: StdinFdSource = {
    get closed() {
      return closed;
    },
    readSync(length) {
      if (closed) throw badFd();
      if (length === 0) return new Uint8Array();
      if (pending.length > 0) return take(length);
      if (eofReceived) return new Uint8Array();
      if (!input)
        throw new NotImplementedError(
          'fs.readSync.stdin',
          'synchronous input requires kernel pull stdin',
        );
      const bytes = input.read(Math.min(length, 64 * 1024), true);
      if (bytes === null) throw new Error('blocking stdin read returned no result');
      if (bytes.length === 0) end();
      return bytes;
    },
    read(length, callback) {
      if (closed) {
        queueMicrotask(() => callback(badFd()));
        return;
      }
      if (length === 0) {
        queueMicrotask(() => callback(null, new Uint8Array()));
        return;
      }
      reads.push({ length, callback });
      syncKeepalive();
      pump();
    },
    close() {
      if (closed) throw badFd();
      closed = true;
      input?.close();
      port?.close();
      pending.length = 0;
      for (const request of reads.splice(0)) queueMicrotask(() => request.callback(badFd()));
      syncKeepalive();
    },
  };
  Object.defineProperty(stdin, STDIN_FD, { value: fd });
  if (port) {
    port.onmessage = (ev: MessageEvent): void => {
      const data = ev.data;
      if (typeof data === 'string' || data instanceof Uint8Array) push(data);
      else if (isStdinEofFrame(data)) end();
      else if (data?.kind === 'stdin:ready') pump();
    };
    port.start();
  }
  return { stdin, push };
}

function isStdinEofFrame(value: unknown): value is { readonly kind: 'stdin:eof' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly kind?: unknown }).kind === 'stdin:eof'
  );
}
