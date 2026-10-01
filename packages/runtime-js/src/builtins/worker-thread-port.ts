import { EventEmitter } from '@riftydev/io';
import { ref, unref } from '../internal/event-loop-keepalive.ts';

type Listener = (...args: unknown[]) => void;
export interface WorkerMessageEvent {
  readonly data: unknown;
}
type MessageHandler = (event: WorkerMessageEvent) => void;

/** Message-listener lifetime uses the same refcount as process IPC (ADR-0491). */
export class WorkerThreadPort extends EventEmitter {
  #referenced = false;
  #held = false;
  #closed = false;
  #onmessage: MessageHandler | null = null;
  constructor(private readonly send: (message: unknown) => void) {
    super();
  }
  get onmessage(): MessageHandler | null {
    return this.#onmessage;
  }
  set onmessage(handler: MessageHandler | null) {
    this.#onmessage = handler;
    this.#referenced = handler !== null || this.listenerCount('message') > 0;
    this.syncRef();
  }
  postMessage(message: unknown): void {
    if (!this.#closed) this.send(message);
  }
  hasRef(): boolean {
    return this.#held;
  }
  ref(): this {
    this.#referenced = true;
    this.syncRef();
    return this;
  }
  unref(): this {
    this.#referenced = false;
    this.syncRef();
    return this;
  }
  start(): void {
    /* Message delivery is already active. */
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.removeAllListeners();
    this.#onmessage = null;
    this.syncRef();
    queueMicrotask(() => this.emit('close'));
  }
  override addListener(event: string | symbol, listener: Listener): this {
    const first = event === 'message' && this.listenerCount(event) === 0;
    super.addListener(event, listener);
    if (first) {
      this.#referenced = true;
      this.syncRef();
    }
    return this;
  }
  override prependListener(event: string | symbol, listener: Listener): this {
    const first = event === 'message' && this.listenerCount(event) === 0;
    super.prependListener(event, listener);
    if (first) {
      this.#referenced = true;
      this.syncRef();
    }
    return this;
  }
  override removeListener(event: string | symbol, listener: Listener): this {
    super.removeListener(event, listener);
    if (event === 'message' && this.listenerCount(event) === 0) {
      this.#referenced = this.#onmessage !== null;
      this.syncRef();
    }
    return this;
  }
  override removeAllListeners(event?: string | symbol): this {
    super.removeAllListeners(event);
    if (event === undefined || event === 'message') {
      this.#referenced = this.#onmessage !== null;
      this.syncRef();
    }
    return this;
  }
  private syncRef(): void {
    const hold = !this.#closed && this.#referenced;
    if (hold === this.#held) return;
    this.#held = hold;
    if (hold) ref();
    else unref();
  }
}
