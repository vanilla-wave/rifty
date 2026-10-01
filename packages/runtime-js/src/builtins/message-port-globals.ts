import { HOST_MESSAGE_PORT, NotImplementedError, createHostMessageChannel } from '@riftydev/io';
import { ref, unref } from '../internal/event-loop-keepalive.ts';

type Callback = EventListenerOrEventListenerObject;
interface PortState {
  port: MessagePort;
  held: boolean;
  refed: boolean;
  closed: boolean;
  onmessage: boolean;
  settingOnMessage: boolean;
  listeners: Map<Callback, EventListener>;
}
const installed = Symbol.for('rifty.runtime-js.message-port-globals.v1');

/** Native transport/brands; only guest references participate in the Node drain. */
export function installNodeMessageChannels(): void {
  if (Reflect.get(globalThis, installed) === true) return;
  const sample = createHostMessageChannel();
  const Native = sample.constructor as typeof MessageChannel;
  sample.port1.close();
  sample.port2.close();
  const proto = globalThis.MessagePort.prototype;
  const message = Object.getOwnPropertyDescriptor(proto, 'onmessage')!;
  const close = proto.close;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  const originalRef = Reflect.get(proto, 'ref') as ((this: MessagePort) => unknown) | undefined;
  const originalUnref = Reflect.get(proto, 'unref') as ((this: MessagePort) => unknown) | undefined;
  const originalHasRef = Reflect.get(proto, 'hasRef') as
    | ((this: MessagePort) => boolean)
    | undefined;
  const states = new WeakMap<MessagePort, PortState>();
  const stateOf = (port: MessagePort, create = false): PortState | undefined => {
    if (Reflect.get(port, HOST_MESSAGE_PORT) === true) return undefined;
    let state = states.get(port);
    if (!state && create) {
      state = {
        port,
        held: false,
        refed: false,
        closed: false,
        onmessage: false,
        settingOnMessage: false,
        listeners: new Map(),
      };
      states.set(port, state);
    }
    return state;
  };
  const sync = (state: PortState): void => {
    const held = !state.closed && state.refed;
    if (originalRef && originalUnref) {
      if (held) originalRef.call(state.port);
      else originalUnref.call(state.port);
    }
    if (held === state.held) return;
    state.held = held;
    if (held) ref();
    else unref();
  };
  const listening = (state: PortState): boolean => state.onmessage || state.listeners.size > 0;
  const auto = (state: PortState, before: boolean): void => {
    if (listening(state) === before) return;
    state.refed = listening(state);
    sync(state);
  };
  Object.defineProperties(proto, {
    ref: {
      configurable: true,
      writable: true,
      value: function (this: MessagePort) {
        message.get?.call(this);
        originalRef?.call(this);
        const state = stateOf(this);
        if (state && !state.settingOnMessage) {
          state.refed = true;
          sync(state);
        }
        return this;
      },
    },
    unref: {
      configurable: true,
      writable: true,
      value: function (this: MessagePort) {
        message.get?.call(this);
        originalUnref?.call(this);
        const state = stateOf(this);
        if (state && !state.settingOnMessage) {
          state.refed = false;
          sync(state);
        }
        return this;
      },
    },
    hasRef: {
      configurable: true,
      writable: true,
      value: function (this: MessagePort) {
        message.get?.call(this);
        const state = stateOf(this);
        return state?.held ?? originalHasRef?.call(this) ?? false;
      },
    },
    close: {
      configurable: true,
      writable: true,
      value: function (this: MessagePort) {
        close.call(this);
        const state = states.get(this);
        if (state && !state.closed) {
          state.closed = true;
          sync(state);
          if (!originalRef) queueMicrotask(() => this.dispatchEvent(new Event('close')));
        }
      },
    },
    onmessage: {
      ...message,
      set: function (this: MessagePort, callback: unknown) {
        const state = stateOf(this);
        const before = state ? listening(state) : false;
        if (state) state.settingOnMessage = true;
        try {
          message.set?.call(this, callback);
        } finally {
          if (state) state.settingOnMessage = false;
        }
        if (state) {
          state.onmessage = typeof message.get?.call(this) === 'function';
          auto(state, before);
          sync(state);
        }
      },
    },
    addEventListener: {
      configurable: true,
      writable: true,
      value: function (
        this: MessagePort,
        type: string,
        callback: Callback | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        const state = stateOf(this);
        if (!state || state.settingOnMessage || type !== 'message' || callback === null)
          return add.call(this, type, callback as Callback, options);
        const before = listening(state);
        if (options === true) throw new NotImplementedError('MessagePort.listener.capture');
        let once = false;
        const observed =
          typeof options === 'object' && options !== null
            ? new Proxy(options, {
                get(target, key, receiver) {
                  const value = Reflect.get(target, key, receiver);
                  if (key === 'once') once = !!value;
                  if (key === 'capture' && value)
                    throw new NotImplementedError('MessagePort.listener.capture');
                  if (key === 'signal' && value !== undefined)
                    throw new NotImplementedError('MessagePort.listener.signal');
                  return value;
                },
              })
            : options;
        let wrapper = state.listeners.get(callback);
        if (!wrapper) {
          wrapper = (event: Event) => {
            if (once) {
              const before = listening(state);
              state.listeners.delete(callback);
              auto(state, before);
            }
            if (typeof callback === 'function') callback.call(this, event);
            else callback.handleEvent(event);
          };
          add.call(this, type, wrapper, observed);
          state.listeners.set(callback, wrapper);
          auto(state, before);
        } else add.call(this, type, wrapper, observed);
        this.start();
      },
    },
    removeEventListener: {
      configurable: true,
      writable: true,
      value: function (
        this: MessagePort,
        type: string,
        callback: Callback | null,
        options?: boolean | EventListenerOptions,
      ) {
        const state = states.get(this);
        if (state?.settingOnMessage) return remove.call(this, type, callback as Callback, options);
        const before = state ? listening(state) : false;
        if (state && options === true)
          throw new NotImplementedError('MessagePort.listener.capture');
        const wrapper = callback === null ? undefined : state?.listeners.get(callback);
        remove.call(this, type, wrapper ?? (callback as Callback), options);
        if (state && type === 'message' && callback !== null && wrapper) {
          state.listeners.delete(callback);
          auto(state, before);
        }
      },
    },
  });
  for (const name of ['on', 'once', 'off', 'addListener', 'removeListener', 'removeAllListeners']) {
    if (typeof Reflect.get(proto, name) !== 'function') {
      Object.defineProperty(proto, name, {
        configurable: true,
        writable: true,
        value: () => {
          throw new NotImplementedError(`MessagePort.${name}`);
        },
      });
    }
  }
  class NodeMessageChannel extends Native {
    constructor() {
      super();
      stateOf(this.port1, true);
      stateOf(this.port2, true);
    }
  }
  Object.defineProperty(NodeMessageChannel, 'name', { value: 'MessageChannel' });
  Object.defineProperty(globalThis, 'MessageChannel', {
    value: NodeMessageChannel,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, installed, { value: true, configurable: true });
}
