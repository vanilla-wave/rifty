/**
 * ADR-0446: Node's `worker_threads` references. A Worker's own
 * `Symbol(kHandle)` / `Symbol(kPublicPort)` objects and a worker realm's
 * `parentPort` each hold one ADR-0152 keepalive ref while referenced. `ref` /
 * `unref` / `hasRef` live on the prototype, so napi-rs can shadow `ref` per
 * object as it does on Node's (rolldown's pool must never hold its parent).
 */
import type { EventEmitter } from '@riftydev/io';
import { ref as keepaliveRef, unref as keepaliveUnref } from './event-loop-keepalive.ts';

export class WorkerReference {
  #referenced = false;
  #disposed = false;

  ref(): void {
    if (this.#referenced || this.#disposed) return;
    this.#referenced = true;
    keepaliveRef();
  }

  unref(): void {
    if (!this.#referenced) return;
    this.#referenced = false;
    keepaliveUnref();
  }

  hasRef(): boolean {
    return this.#referenced;
  }

  /** The Worker ended or the port closed: release, whatever `unref` now is, and never hold again. */
  static dispose(reference: WorkerReference): void {
    reference.#disposed = true;
    if (!reference.#referenced) return;
    reference.#referenced = false;
    keepaliveUnref();
  }
}

interface Reference {
  ref(): unknown;
  unref(): unknown;
}

const kHandle = Symbol('kHandle');
const kPublicPort = Symbol('kPublicPort');

type ReferenceSlots = Record<typeof kHandle | typeof kPublicPort, Reference | null>;

export interface WorkerReferences {
  /** Node's `kDispose`: release both, then both slots read `null`. */
  dispose(): void;
  /**
   * Run the emitter's `removeAllListeners`. Node's emits `'removeListener'` per
   * dropped listener, so a still-installed referencing listener unrefs
   * `kPublicPort`; `@riftydev/io`'s clears silently.
   */
  removeAll(event: string | symbol | undefined, clear: () => void): void;
}

/**
 * Node's Worker constructor tail: `kHandle` referenced, `kPublicPort` driven by
 * `'message'` listeners (`setupPortReferencing`; `port.ref` read at call time).
 */
export function attachWorkerReferences(worker: EventEmitter): WorkerReferences {
  const handle = new WorkerReference();
  const publicPort = new WorkerReference();
  handle.ref();
  const slots = worker as unknown as ReferenceSlots;
  slots[kHandle] = handle;
  slots[kPublicPort] = publicPort;
  const onRemoveListener = (name: unknown): void => {
    if (name === 'message' && worker.listenerCount(name) === 0) publicPort.unref();
  };
  worker.on('newListener', (name) => {
    if (name === 'message' && worker.listenerCount(name) === 0) publicPort.ref();
  });
  worker.on('removeListener', onRemoveListener);
  return {
    dispose() {
      WorkerReference.dispose(handle);
      WorkerReference.dispose(publicPort);
      slots[kHandle] = null;
      slots[kPublicPort] = null;
    },
    removeAll(event, clear) {
      const referencing = worker.listeners('removeListener').includes(onRemoveListener);
      const listened = worker.listenerCount('message') > 0;
      clear();
      if (referencing && listened && (event === undefined || event === 'message')) {
        onRemoveListener('message');
      }
    },
  };
}

/** `Worker#ref` / `unref`, Node's body: through both slots, nothing after the end. */
export function referenceWorker(worker: object, method: 'ref' | 'unref'): void {
  const slots = worker as ReferenceSlots;
  const handle = slots[kHandle];
  if (handle === null) return;
  handle[method]();
  (slots[kPublicPort] as Reference)[method]();
}

type Listener = (...args: unknown[]) => void;

interface ParentPort extends EventEmitter {
  onmessage: unknown;
  close(): void;
  ref(): unknown;
  unref(): unknown;
  hasRef?(): boolean;
}

const ADDERS = ['addListener', 'on', 'once', 'prependListener', 'prependOnceListener'] as const;
const REMOVERS = ['removeListener', 'off'] as const;

/**
 * A worker realm's `parentPort` as Node's MessagePort: its first `'message'`
 * listener (or `onmessage` function) references it, removing the last one
 * unreferences it; `removeAllListeners` (silent here, `kRemoveListener`-free in
 * Node's NodeEventTarget) leaves it as is; `close()` releases it for good.
 */
export function referenceParentPort(port: ParentPort): void {
  const reference = new WorkerReference();
  let handler: unknown = null;
  const size = (): number =>
    port.listenerCount('message') + (typeof handler === 'function' ? 1 : 0);
  const own = port as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ADDERS) {
    const add = own[name] as (event: string | symbol, listener: Listener) => unknown;
    own[name] = (event, listener) => {
      const before = event === 'message' ? size() : -1;
      add.call(port, event as string | symbol, listener as Listener);
      if (before === 0 && size() > 0) reference.ref();
      return port;
    };
  }
  for (const name of REMOVERS) {
    const remove = own[name] as (event: string | symbol, listener: Listener) => unknown;
    own[name] = (event, listener) => {
      const before = event === 'message' ? size() : 0;
      remove.call(port, event as string | symbol, listener as Listener);
      if (before > 0 && size() === 0) reference.unref();
      return port;
    };
  }
  Object.defineProperty(port, 'onmessage', {
    configurable: true,
    enumerable: true,
    get: () => handler,
    set(value: unknown) {
      const before = size();
      const wasFunction = typeof handler === 'function';
      handler = value ?? null;
      const isFunction = typeof handler === 'function';
      if (!wasFunction && isFunction && before === 0) reference.ref();
      if (wasFunction && !isFunction && size() === 0) reference.unref();
    },
  });
  port.ref = () => {
    reference.ref();
  };
  port.unref = () => {
    reference.unref();
  };
  port.hasRef = () => reference.hasRef();
  const close = port.close;
  port.close = () => {
    WorkerReference.dispose(reference);
    close.call(port);
  };
}
