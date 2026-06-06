/**
 * Node-compatible `node:diagnostics_channel`.
 *
 * Pure-JS re-implementation of Node's named publish/subscribe diagnostics bus
 * and its `TracingChannel` helper. Node has no native binding here either — it
 * is a JS-level registry — so we mirror the observable contract rather than
 * stub it (CLAUDE.md "no silent stubs").
 *
 * `runStores` depends on an `AsyncLocalStorage`-shaped object exposing
 * `run(store, callback)`. rifty's `node:async_hooks` does not yet model async
 * context, so we run the callback synchronously inside each bound store's `run`
 * — correct for the synchronous span (the part before any `await`).
 */

type OnMessage = (message: unknown, name: string | symbol) => void;

interface AsyncLocalStorageLike {
  run<R>(store: unknown, callback: (...args: unknown[]) => R, ...args: unknown[]): R;
}

type StoreTransform = (message: unknown) => unknown;

const reportSubscriberError = (err: unknown): void => {
  // Node surfaces a throwing subscriber but keeps delivering to the rest;
  // mirror "surface, do not abort" by logging without breaking the publish loop.
  // eslint-disable-next-line no-console
  console.error(err);
};

/**
 * A named diagnostics channel. Node lazily upgrades an inert "no subscribers"
 * channel to an active one; we use one class whose `publish` is a no-op while
 * the subscriber set is empty — the observable equivalent.
 */
export class Channel {
  readonly name: string | symbol;
  #subscribers: OnMessage[] = [];
  #stores = new Map<AsyncLocalStorageLike, StoreTransform>();

  constructor(name: string | symbol) {
    this.name = name;
  }

  get hasSubscribers(): boolean {
    return this.#subscribers.length > 0;
  }

  subscribe(onMessage: OnMessage): void {
    if (typeof onMessage !== 'function') {
      throw new TypeError('The "onMessage" argument must be of type function.');
    }
    this.#subscribers.push(onMessage);
  }

  unsubscribe(onMessage: OnMessage): boolean {
    const idx = this.#subscribers.indexOf(onMessage);
    if (idx === -1) {
      return false;
    }
    this.#subscribers.splice(idx, 1);
    return true;
  }

  publish(message: unknown): void {
    if (this.#subscribers.length === 0) {
      return;
    }
    // Snapshot: a subscriber that (un)subscribes mid-delivery must not perturb
    // the in-flight loop — matches Node.
    for (const onMessage of this.#subscribers.slice()) {
      try {
        onMessage(message, this.name);
      } catch (err) {
        reportSubscriberError(err);
      }
    }
  }

  bindStore(store: AsyncLocalStorageLike, transform?: StoreTransform): void {
    this.#stores.set(store, transform ?? ((message: unknown) => message));
  }

  unbindStore(store: AsyncLocalStorageLike): boolean {
    return this.#stores.delete(store);
  }

  runStores<R>(
    message: unknown,
    fn: (...args: unknown[]) => R,
    thisArg?: unknown,
    ...args: unknown[]
  ): R {
    // Node publishes the message before entering the bound stores.
    this.publish(message);
    let run = (): R => fn.apply(thisArg, args);
    for (const [store, transform] of this.#stores) {
      const inner = run;
      run = (): R => store.run(transform(message), inner);
    }
    return run();
  }
}

const channels = new Map<string | symbol, Channel>();

export function channel(name: string | symbol): Channel {
  const existing = channels.get(name);
  if (existing) {
    return existing;
  }
  const created = new Channel(name);
  channels.set(name, created);
  return created;
}

export function hasSubscribers(name: string | symbol): boolean {
  const existing = channels.get(name);
  return existing ? existing.hasSubscribers : false;
}

export function subscribe(name: string | symbol, onMessage: OnMessage): void {
  channel(name).subscribe(onMessage);
}

export function unsubscribe(name: string | symbol, onMessage: OnMessage): boolean {
  return channel(name).unsubscribe(onMessage);
}

interface TraceContext {
  result?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

interface TracingSubscribers {
  start?: OnMessage;
  end?: OnMessage;
  asyncStart?: OnMessage;
  asyncEnd?: OnMessage;
  error?: OnMessage;
}

const TRACING_EVENTS = ['start', 'end', 'asyncStart', 'asyncEnd', 'error'] as const;
type TracingEvent = (typeof TRACING_EVENTS)[number];

/**
 * Groups the five lifecycle sub-channels for a traced operation plus the
 * `traceSync` / `tracePromise` / `traceCallback` helpers. Sub-channel names
 * follow Node's `tracing:<base>:<event>` convention so external subscribers
 * line up.
 */
export class TracingChannel {
  readonly start: Channel;
  readonly end: Channel;
  readonly asyncStart: Channel;
  readonly asyncEnd: Channel;
  readonly error: Channel;

  constructor(nameOrChannels: string | Partial<Record<TracingEvent, Channel>>) {
    if (typeof nameOrChannels === 'string') {
      this.start = channel(`tracing:${nameOrChannels}:start`);
      this.end = channel(`tracing:${nameOrChannels}:end`);
      this.asyncStart = channel(`tracing:${nameOrChannels}:asyncStart`);
      this.asyncEnd = channel(`tracing:${nameOrChannels}:asyncEnd`);
      this.error = channel(`tracing:${nameOrChannels}:error`);
      return;
    }
    this.start = nameOrChannels.start as Channel;
    this.end = nameOrChannels.end as Channel;
    this.asyncStart = nameOrChannels.asyncStart as Channel;
    this.asyncEnd = nameOrChannels.asyncEnd as Channel;
    this.error = nameOrChannels.error as Channel;
  }

  get hasSubscribers(): boolean {
    return (
      this.start.hasSubscribers ||
      this.end.hasSubscribers ||
      this.asyncStart.hasSubscribers ||
      this.asyncEnd.hasSubscribers ||
      this.error.hasSubscribers
    );
  }

  subscribe(subscribers: TracingSubscribers): void {
    for (const event of TRACING_EVENTS) {
      const onMessage = subscribers[event];
      if (onMessage) {
        this[event].subscribe(onMessage);
      }
    }
  }

  unsubscribe(subscribers: TracingSubscribers): boolean {
    let removedAll = true;
    for (const event of TRACING_EVENTS) {
      const onMessage = subscribers[event];
      if (onMessage && !this[event].unsubscribe(onMessage)) {
        removedAll = false;
      }
    }
    return removedAll;
  }

  traceSync<R>(
    fn: (...args: unknown[]) => R,
    context: TraceContext = {},
    thisArg?: unknown,
    ...args: unknown[]
  ): R {
    // `start.runStores` already publishes `start`; calling `start.publish`
    // again would fire it twice.
    try {
      const result = this.start.runStores(context, () => fn.apply(thisArg, args));
      context.result = result;
      return result;
    } catch (err) {
      context.error = err;
      this.error.publish(context);
      throw err;
    } finally {
      this.end.publish(context);
    }
  }

  tracePromise<R>(
    fn: (...args: unknown[]) => Promise<R>,
    context: TraceContext = {},
    thisArg?: unknown,
    ...args: unknown[]
  ): Promise<R> {
    let promise: Promise<R>;
    try {
      promise = this.start.runStores(context, () => fn.apply(thisArg, args));
    } catch (err) {
      context.error = err;
      this.error.publish(context);
      this.end.publish(context);
      throw err;
    }
    this.end.publish(context);
    // `asyncStart`/`asyncEnd` fire at settlement (after the await) with the
    // settled `result`/`error` on the context — not while the promise pends.
    return Promise.resolve(promise).then(
      (result) => {
        context.result = result;
        this.asyncStart.publish(context);
        this.asyncEnd.publish(context);
        return result;
      },
      (err) => {
        context.error = err;
        this.error.publish(context);
        this.asyncStart.publish(context);
        this.asyncEnd.publish(context);
        throw err;
      },
    );
  }

  traceCallback<R>(
    fn: (...args: unknown[]) => R,
    position = -1,
    context: TraceContext = {},
    thisArg?: unknown,
    ...args: unknown[]
  ): R {
    const self = this;
    const wrappedArgs = args.slice();
    const original = position >= 0 ? wrappedArgs[position] : wrappedArgs[wrappedArgs.length - 1];
    const wrapped = function wrappedCallback(this: unknown, ...cbArgs: unknown[]): unknown {
      const err = cbArgs[0];
      if (err != null) {
        context.error = err;
        self.error.publish(context);
      } else {
        context.result = cbArgs[1];
      }
      self.asyncStart.publish(context);
      try {
        if (typeof original === 'function') {
          return (original as (...a: unknown[]) => unknown).apply(this, cbArgs);
        }
        return undefined;
      } finally {
        self.asyncEnd.publish(context);
      }
    };
    if (position >= 0) {
      wrappedArgs[position] = wrapped;
    } else {
      wrappedArgs[wrappedArgs.length - 1] = wrapped;
    }

    // `start.runStores` already publishes `start`; do not publish it again.
    try {
      return this.start.runStores(context, () => fn.apply(thisArg, wrappedArgs));
    } catch (err) {
      context.error = err;
      this.error.publish(context);
      throw err;
    } finally {
      this.end.publish(context);
    }
  }
}

export function tracingChannel(
  nameOrChannels: string | Partial<Record<TracingEvent, Channel>>,
): TracingChannel {
  return new TracingChannel(nameOrChannels);
}

const diagnosticsChannel = {
  Channel,
  TracingChannel,
  channel,
  hasSubscribers,
  subscribe,
  unsubscribe,
  tracingChannel,
};

export default diagnosticsChannel;
