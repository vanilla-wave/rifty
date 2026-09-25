import { ref, unref } from '../internal/event-loop-keepalive.ts';
import { EventEmitter } from './events.ts';

export type WorkerMessageHandler = (event: { readonly data: unknown }) => void;
type Listener = (...args: unknown[]) => void;

/** Shared first/last message-listener transitions for Worker and parentPort. */
export abstract class MessageListenerEmitter extends EventEmitter {
  protected messageListeners(): number {
    return this.listenerCount('message');
  }
  protected abstract syncListeners(before: number): void;

  override addListener(event: string | symbol, listener: Listener): this {
    const before = this.messageListeners();
    super.addListener(event, listener);
    if (event === 'message') this.syncListeners(before);
    return this;
  }

  override prependListener(event: string | symbol, listener: Listener): this {
    const before = this.messageListeners();
    super.prependListener(event, listener);
    if (event === 'message') this.syncListeners(before);
    return this;
  }

  override removeListener(event: string | symbol, listener: Listener): this {
    const before = this.messageListeners();
    super.removeListener(event, listener);
    if (event === 'message') this.syncListeners(before);
    return this;
  }

  override removeAllListeners(event?: string | symbol): this {
    const before = this.messageListeners();
    super.removeAllListeners(event);
    if (event === undefined || event === 'message') this.syncListeners(before);
    return this;
  }
}

/** A kernel parentPort owns its child-realm ref; fallback ports share a realm. */
export class WorkerPort extends MessageListenerEmitter {
  #onmessage: WorkerMessageHandler | null = null;
  #refed = false;
  #closed = false;

  constructor(
    private readonly send: (message: unknown) => void,
    private readonly counted = false,
  ) {
    super();
  }

  get onmessage(): WorkerMessageHandler | null {
    return this.#onmessage;
  }
  set onmessage(listener: WorkerMessageHandler | null) {
    const before = this.messageListeners();
    this.#onmessage = listener;
    this.syncListeners(before);
  }

  postMessage(message: unknown): void {
    if (!this.#closed) this.send(message);
  }
  start(): void {}
  ref(): void {
    if (!this.#closed && !this.#refed) {
      this.#refed = true;
      if (this.counted) ref();
    }
  }
  unref(): void {
    if (this.#refed) {
      this.#refed = false;
      if (this.counted) unref();
    }
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.unref();
    this.#onmessage = null;
    super.removeAllListeners();
  }

  static deliver(port: WorkerPort, message: unknown): void {
    if (port.#closed) return;
    port.emit('message', message);
    port.onmessage?.({ data: message });
  }

  protected override messageListeners(): number {
    return this.listenerCount('message') + (this.#onmessage === null ? 0 : 1);
  }
  protected override syncListeners(before: number): void {
    const after = this.messageListeners();
    if (after === 0) this.unref();
    else if (before === 0) this.ref();
  }
}
