import { createHostMessageChannel } from '@riftydev/io';
import { expect, it } from 'vitest';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { installNodeMessageChannels } from './message-port-globals.ts';

it('tracks guest port transitions without referencing native host channels', async () => {
  const names = [
    'ref',
    'unref',
    'hasRef',
    'close',
    'onmessage',
    'addEventListener',
    'removeEventListener',
  ];
  const proto = MessagePort.prototype;
  const saved = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(proto, name)]));
  const constructor = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel')!;
  const guestChannels: MessageChannel[] = [];
  const host = createHostMessageChannel();
  try {
    installNodeMessageChannels();
    host.port1.onmessage = () => {};
    expect(activeRefs()).toBe(0);
    const channel = new MessageChannel();
    guestChannels.push(channel);
    const p = channel.port1 as MessagePort & {
      ref(): unknown;
      unref(): unknown;
      hasRef(): boolean;
    };
    p.ref();
    p.onmessage = null;
    expect(p.hasRef()).toBe(true);
    expect(activeRefs()).toBe(1);
    p.onmessage = () => {};
    p.unref();
    p.onmessage = () => {};
    expect(p.hasRef()).toBe(false);
    expect(activeRefs()).toBe(0);
    p.onmessage = null;
    const received = new Promise<unknown>((resolve) => {
      p.onmessage = (event) => resolve(event.data);
    });
    expect(activeRefs()).toBe(1);
    channel.port2.postMessage({ answer: 42 });
    expect(await received).toEqual({ answer: 42 });
    p.close();
    channel.port2.close();
    expect(activeRefs()).toBe(0);
  } finally {
    for (const channel of guestChannels) {
      channel.port1.close();
      channel.port2.close();
    }
    host.port1.close();
    host.port2.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else Reflect.deleteProperty(proto, name);
    }
    Object.defineProperty(globalThis, 'MessageChannel', constructor);
    Reflect.deleteProperty(globalThis, Symbol.for('rifty.runtime-js.message-port-globals.v1'));
    resetKeepalive();
  }
});
