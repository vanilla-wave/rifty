import { describe, expect, it } from 'vitest';
import { EventEmitter, once } from './event-emitter.ts';

describe('EventEmitter construction surface', () => {
  it('supports legacy call initialisation on an inherited prototype', () => {
    const bus = Object.create(EventEmitter.prototype) as EventEmitter;

    expect(EventEmitter.call(bus)).toBeUndefined();
    expect(bus).toBeInstanceOf(EventEmitter);

    const seen: unknown[] = [];
    bus.on('message', (value) => seen.push(value));
    expect(bus.emit('message', 42)).toBe(true);
    expect(seen).toEqual([42]);
  });

  it('preserves modern subclass, constructor, and static-default behavior', () => {
    class Bus extends EventEmitter {}

    const originalMax = EventEmitter.defaultMaxListeners;
    try {
      EventEmitter.defaultMaxListeners = 3;
      const bus = new Bus();
      expect(bus).toBeInstanceOf(Bus);
      expect(bus).toBeInstanceOf(EventEmitter);
      expect(EventEmitter.prototype.constructor).toBe(EventEmitter);
      expect(bus.getMaxListeners()).toBe(3);
      expect(typeof EventEmitter.captureRejectionSymbol).toBe('symbol');
    } finally {
      EventEmitter.defaultMaxListeners = originalMax;
    }
  });
});

describe('EventEmitter.listeners vs rawListeners', () => {
  it('listeners() returns unwrapped originals for once()', () => {
    const ee = new EventEmitter();
    const handler = (): void => {};
    ee.once('a', handler);
    const ls = ee.listeners('a');
    expect(ls).toHaveLength(1);
    expect(ls[0]).toBe(handler);
  });

  it('rawListeners() returns the wrapper (with `.listener` set)', () => {
    const ee = new EventEmitter();
    const handler = (): void => {};
    ee.once('a', handler);
    const raw = ee.rawListeners('a');
    expect(raw).toHaveLength(1);
    expect(raw[0]).not.toBe(handler);
    expect((raw[0] as { listener?: typeof handler }).listener).toBe(handler);
  });

  it('plain on() listeners appear identical in listeners() and rawListeners()', () => {
    const ee = new EventEmitter();
    const handler = (): void => {};
    ee.on('b', handler);
    const ls = ee.listeners('b');
    const raw = ee.rawListeners('b');
    expect(ls[0]).toBe(handler);
    expect(raw[0]).toBe(handler);
  });
});

describe('EventEmitter.removeListener with once() wrapper', () => {
  it('removes by original function passed to once()', () => {
    const ee = new EventEmitter();
    const handler = (): void => {};
    ee.once('a', handler);
    expect(ee.listenerCount('a')).toBe(1);
    ee.removeListener('a', handler);
    expect(ee.listenerCount('a')).toBe(0);
  });

  it('removes only the last matching once() registration', () => {
    const ee = new EventEmitter();
    const handler = (): void => {};
    ee.once('a', handler);
    ee.once('a', handler);
    expect(ee.listenerCount('a')).toBe(2);
    ee.removeListener('a', handler);
    expect(ee.listenerCount('a')).toBe(1);
    ee.removeListener('a', handler);
    expect(ee.listenerCount('a')).toBe(0);
  });

  it('removes by wrapper reference too', () => {
    const ee = new EventEmitter();
    const handler = (): void => {};
    ee.once('a', handler);
    const wrapper = ee.rawListeners('a')[0];
    if (wrapper === undefined) throw new Error('wrapper missing');
    ee.removeListener('a', wrapper);
    expect(ee.listenerCount('a')).toBe(0);
  });
});

describe("EventEmitter 'newListener' meta-event", () => {
  it('fires for plain addListener (on)', () => {
    const ee = new EventEmitter();
    const seen: [string | symbol, unknown][] = [];
    ee.on('newListener', (...args) => {
      seen.push([args[0] as string, args[1]]);
    });
    const handler = (): void => {};
    ee.on('foo', handler);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe('foo');
    expect(seen[0]?.[1]).toBe(handler);
  });

  it('fires for prependListener', () => {
    const ee = new EventEmitter();
    const seen: [string | symbol, unknown][] = [];
    ee.on('newListener', (...args) => {
      seen.push([args[0] as string, args[1]]);
    });
    const handler = (): void => {};
    ee.prependListener('foo', handler);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe('foo');
    expect(seen[0]?.[1]).toBe(handler);
  });

  it('fires for prependOnceListener', () => {
    const ee = new EventEmitter();
    const seen: [string | symbol, unknown][] = [];
    ee.on('newListener', (...args) => {
      seen.push([args[0] as string, args[1]]);
    });
    const handler = (): void => {};
    ee.prependOnceListener('foo', handler);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe('foo');
    // The wrapper is registered, but it carries `.listener` pointing at the
    // original handler — same shape Node passes to the newListener hook.
    expect((seen[0]?.[1] as { listener?: typeof handler }).listener).toBe(handler);
  });

  it('does not re-emit when adding a `newListener` handler itself', () => {
    const ee = new EventEmitter();
    let count = 0;
    ee.on('newListener', () => {
      count++;
    });
    expect(count).toBe(0);
  });
});

describe('once() promise helper cleanup', () => {
  it('removes both listeners on resolve path', () => {
    const ee = new EventEmitter();
    const p = once(ee, 'x');
    expect(ee.listenerCount('x')).toBe(1);
    expect(ee.listenerCount('error')).toBe(1);
    ee.emit('x', 1, 2);
    return p.then((args) => {
      expect(args).toEqual([1, 2]);
      expect(ee.listenerCount('x')).toBe(0);
      expect(ee.listenerCount('error')).toBe(0);
    });
  });

  it('removes both listeners on reject path (error)', async () => {
    const ee = new EventEmitter();
    const p = once(ee, 'x');
    expect(ee.listenerCount('x')).toBe(1);
    expect(ee.listenerCount('error')).toBe(1);
    const err = new Error('boom');
    ee.emit('error', err);
    await p.then(
      () => {
        throw new Error('expected reject');
      },
      (received) => {
        expect(received).toBe(err);
      },
    );
    expect(ee.listenerCount('x')).toBe(0);
    expect(ee.listenerCount('error')).toBe(0);
  });
});
