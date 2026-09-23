import { NotImplementedError } from '@riftydev/io';
import { getKernelHostMessageChannel } from '@riftydev/kernel';
import { ref, unref } from './event-loop-keepalive.ts';

const INSTALLED = Symbol.for('rifty.runtime-js.message-port-keepalive.v1');
interface PortState {
  readonly port: MessagePort;
  peer: PortState;
  phase: 'open' | 'closing' | 'closed';
  held: boolean;
  started: boolean;
  pending: number;
  closingRef: boolean;
  checkpointPassed: boolean;
  finishQueued: boolean;
}
type PortRefMethods = {
  ref?: (this: MessagePort) => void;
  unref?: (this: MessagePort) => void;
  hasRef?: (this: MessagePort) => boolean;
};

/** ADR-0452: only public local pairs gain manual Node lifetime; kernel stays raw. */
export function installMessagePortKeepalive(): void {
  if (Reflect.get(globalThis, INSTALLED)) return;
  const HostChannel = getKernelHostMessageChannel();
  const proto = MessagePort.prototype;
  const nativeClose = proto.close;
  const nativePost = proto.postMessage;
  const nativeStart = proto.start;
  const nativeAdd = proto.addEventListener;
  const nativeRef = (proto as PortRefMethods).ref;
  const nativeUnref = (proto as PortRefMethods).unref;
  const nativeHasRef = (proto as PortRefMethods).hasRef;
  const nativeCloseEvents = typeof nativeHasRef === 'function';
  const ports = new WeakMap<MessagePort, PortState>();

  // One task source when a caller has no Node check-phase scheduler (page probes).
  const tasks: Array<() => void> = [];
  const taskChannel = new HostChannel();
  taskChannel.port1.onmessage = () => tasks.shift()?.();
  nativeUnref?.call(taskChannel.port1);
  const immediate = Reflect.get(globalThis, 'setImmediate') as
    | ((callback: () => void) => unknown)
    | undefined;
  const enqueue = (callback: () => void): void => {
    if (typeof immediate === 'function') {
      immediate(callback);
      return;
    }
    tasks.push(callback);
    nativePost.call(taskChannel.port2, null);
  };

  const hold = (state: PortState, value: boolean): void => {
    if (state.phase === 'closed' || state.held === value) return;
    state.held = value;
    if (value) ref();
    else unref();
  };
  const finish = (state: PortState): void => {
    if (state.phase === 'closed') return;
    hold(state, false);
    state.phase = 'closed';
    if (state.closingRef) {
      state.closingRef = false;
      unref();
    }
    if (!nativeCloseEvents) {
      nativeClose.call(state.port);
      state.port.dispatchEvent(new Event('close'));
    }
  };
  const maybeFinish = (state: PortState): void => {
    if (
      nativeCloseEvents ||
      state.phase !== 'closing' ||
      !state.checkpointPassed ||
      state.finishQueued ||
      (state.started && state.pending > 0)
    )
      return;
    state.finishQueued = true;
    // Never notify close from inside the capture listener ahead of guest message handlers.
    enqueue(() => finish(state));
  };
  const closeLater = (state: PortState): void => {
    if (state.phase !== 'open') return;
    state.phase = 'closing';
    state.closingRef = true;
    ref();
    if (!nativeCloseEvents)
      enqueue(() =>
        enqueue(() => {
          state.checkpointPassed = true;
          maybeFinish(state);
        }),
      );
  };
  const register = (port: MessagePort): PortState => {
    const state = {
      port,
      phase: 'open',
      held: false,
      started: false,
      pending: 0,
      closingRef: false,
      checkpointPassed: false,
      finishQueued: false,
    } as Omit<PortState, 'peer'> & Partial<Pick<PortState, 'peer'>>;
    // Pair construction sets both peers before exposing either port.
    const registered = state as PortState;
    ports.set(port, registered);
    if (!nativeCloseEvents)
      nativeAdd.call(
        port,
        'message',
        () => {
          registered.pending = Math.max(0, registered.pending - 1);
          maybeFinish(registered);
        },
        true,
      );
    if (nativeCloseEvents) nativeAdd.call(port, 'close', () => finish(registered));
    return registered;
  };

  const checkedTransfer = (value: unknown, suppliedIterator?: unknown): unknown => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value;
    const iterator: unknown = suppliedIterator ?? Reflect.get(value, Symbol.iterator);
    if (typeof iterator !== 'function') return { [Symbol.iterator]: iterator };
    const items = Array.from({
      [Symbol.iterator]: () => Reflect.apply(iterator, value, []) as Iterator<unknown>,
    });
    for (const item of items) {
      if (typeof item === 'object' && item !== null && ports.has(item as MessagePort)) {
        throw new NotImplementedError('MessagePort.transfer.managed');
      }
    }
    return items;
  };
  const transferDictionary = (value: unknown, iterator?: unknown): unknown => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value;
    // Snapshot transfer and overload choice; native must not re-read caller getters.
    // Fresh target also avoids frozen caller-property Proxy invariants.
    const transfer = checkedTransfer(Reflect.get(value, 'transfer'));
    return new Proxy(
      {},
      {
        get(_target, key) {
          if (key === Symbol.iterator) return iterator;
          return key === 'transfer' ? transfer : Reflect.get(value, key, value);
        },
      },
    );
  };
  const transferArgument = (value: unknown): unknown => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value;
    const iterator: unknown = Reflect.get(value, Symbol.iterator);
    // Preserve native rejection without reading dictionary getters for an invalid iterator.
    if (iterator != null && typeof iterator !== 'function') return { [Symbol.iterator]: iterator };
    return typeof iterator === 'function'
      ? checkedTransfer(value, iterator)
      : transferDictionary(value, iterator);
  };
  const replaceMethod = (target: object, key: string, value: unknown): void => {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    if (typeof value === 'function') {
      Object.defineProperty(value, 'name', { value: key, configurable: true });
      if (typeof previous?.value === 'function') {
        Object.defineProperty(value, 'length', {
          value: previous.value.length,
          configurable: true,
        });
      }
    }
    Object.defineProperty(target, key, {
      ...previous,
      value,
      configurable: true,
      writable: true,
    });
  };

  replaceMethod(proto, 'ref', function (this: MessagePort): void {
    const state = ports.get(this);
    if (!state) {
      if (nativeRef) {
        nativeRef.call(this);
        return;
      }
      throw new NotImplementedError('MessagePort.ref.untracked');
    }
    if (state.phase !== 'closed') nativeRef?.call(this);
    hold(state, true);
  });
  replaceMethod(proto, 'unref', function (this: MessagePort): void {
    const state = ports.get(this);
    if (!state) {
      if (nativeUnref) {
        nativeUnref.call(this);
        return;
      }
      throw new NotImplementedError('MessagePort.unref.untracked');
    }
    nativeUnref?.call(this);
    hold(state, false);
  });
  replaceMethod(proto, 'hasRef', function (this: MessagePort): boolean {
    const state = ports.get(this);
    if (!state) {
      if (nativeHasRef) return nativeHasRef.call(this);
      throw new NotImplementedError('MessagePort.hasRef.untracked');
    }
    return state.held;
  });
  replaceMethod(proto, 'close', function (this: MessagePort): void {
    nativeClose.call(this);
    const state = ports.get(this);
    if (!state) return;
    // An explicit local close discards this endpoint's unread native queue.
    state.pending = 0;
    state.started = false;
    closeLater(state);
    closeLater(state.peer);
    maybeFinish(state);
  });
  replaceMethod(proto, 'start', function (this: MessagePort): void {
    nativeStart.call(this);
    const state = ports.get(this);
    if (state) state.started = true;
  });
  replaceMethod(proto, 'postMessage', function (this: MessagePort, ...args: unknown[]): void {
    if (args.length > 1) args[1] = transferArgument(args[1]);
    Reflect.apply(nativePost, this, args);
    const state = ports.get(this);
    if (state?.phase === 'open' && state.peer.phase === 'open') state.peer.pending += 1;
  });

  const onmessage = Object.getOwnPropertyDescriptor(proto, 'onmessage');
  if (onmessage?.set) {
    const set = onmessage.set;
    Object.defineProperty(proto, 'onmessage', {
      ...onmessage,
      set(this: MessagePort, value: unknown) {
        set.call(this, value);
        const state = ports.get(this);
        if (state && onmessage.get?.call(this) !== null) state.started = true;
      },
    });
  }

  const clone = globalThis.structuredClone;
  if (typeof clone === 'function')
    replaceMethod(
      globalThis,
      'structuredClone',
      <T>(value: T, options?: StructuredSerializeOptions): T =>
        Reflect.apply(clone, globalThis, [value, transferDictionary(options)]) as T,
    );
  const WorkerCtor = globalThis.Worker;
  if (typeof WorkerCtor === 'function') {
    const workerPost = WorkerCtor.prototype.postMessage;
    replaceMethod(
      WorkerCtor.prototype,
      'postMessage',
      function (this: Worker, ...args: unknown[]): void {
        if (args.length > 1) args[1] = transferArgument(args[1]);
        Reflect.apply(workerPost, this, args);
      },
    );
  }
  const globalPost: unknown = Reflect.get(globalThis, 'postMessage');
  if (typeof globalPost === 'function')
    replaceMethod(globalThis, 'postMessage', function (this: unknown, ...args: unknown[]): void {
      if (args.length > 1) args[1] = transferArgument(args[1]);
      if (args.length > 2) args[2] = checkedTransfer(args[2]);
      Reflect.apply(globalPost, this, args);
    });

  const PublicChannel = new Proxy(HostChannel, {
    construct(target, args, newTarget) {
      const channel = Reflect.construct(target, args, newTarget) as MessageChannel;
      const first = register(channel.port1);
      const second = register(channel.port2);
      first.peer = second;
      second.peer = first;
      return channel;
    },
  });
  Object.defineProperty(globalThis, INSTALLED, { value: true });
  globalThis.MessageChannel = PublicChannel;
}
