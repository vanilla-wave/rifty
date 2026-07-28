import { inherits } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './event-emitter.ts';

describe('EventEmitter callable construction', () => {
  it('initialises a receiver in place without replacing the exported prototype', () => {
    const target = Object.create(EventEmitter.prototype) as EventEmitter;

    expect(EventEmitter.call(target)).toBeUndefined();
    expect(target).toBeInstanceOf(EventEmitter);
    expect(Object.getPrototypeOf(target)).toBe(EventEmitter.prototype);
    expect(EventEmitter.prototype.constructor).toBe(EventEmitter);

    const seen: unknown[] = [];
    EventEmitter.prototype.on.call(target, 'value', (value) => seen.push(value));
    expect(target.emit('value', 42)).toBe(true);
    expect(seen).toEqual([42]);
  });

  it('uses the same listener state for new, subclass, and util.inherits forms', () => {
    function LegacyBus(this: EventEmitter & { callResult?: unknown }): void {
      this.callResult = EventEmitter.call(this);
    }
    inherits(LegacyBus, EventEmitter);

    class ModernBus extends EventEmitter {}

    const legacy = new (
      LegacyBus as unknown as new () => EventEmitter & {
        callResult?: unknown;
      }
    )();
    const modern = new ModernBus();
    const direct = new EventEmitter();
    const seen: string[] = [];

    legacy.on('value', () => seen.push('legacy'));
    modern.on('value', () => seen.push('modern'));
    direct.on('value', () => seen.push('direct'));

    expect(EventEmitter.prototype.emit.call(legacy, 'value')).toBe(true);
    expect(modern.emit('value')).toBe(true);
    expect(direct.emit('value')).toBe(true);
    expect(seen).toEqual(['legacy', 'modern', 'direct']);
    expect(legacy.callResult).toBeUndefined();
    expect(legacy).toBeInstanceOf(EventEmitter);
    expect(legacy).toBeInstanceOf(LegacyBus);
    expect(modern).toBeInstanceOf(EventEmitter);
    expect(modern).toBeInstanceOf(ModernBus);
    expect(Object.getPrototypeOf(LegacyBus.prototype)).toBe(EventEmitter.prototype);
    expect((LegacyBus as typeof LegacyBus & { super_?: unknown }).super_).toBe(EventEmitter);
  });
});

describe('EventEmitter.call on a receiver whose prototype already emits', () => {
  it('gives the receiver its own listener state instead of the inherited one', () => {
    // Node's `EventEmitter.init` resets `_events` when the receiver only
    // INHERITS it, so the legacy `Foo.prototype = new EventEmitter()` idiom
    // gives each instance a private store. Sharing the prototype's store
    // instead would let one instance's listeners fire for another's events —
    // and `removeAllListeners` on one would silently disarm the rest.
    const shared = new EventEmitter();
    const inherited = vi.fn();
    shared.on('ping', inherited);
    function Legacy(this: EventEmitter) {
      EventEmitter.call(this);
    }
    Legacy.prototype = shared;

    const instance = new (Legacy as unknown as new () => EventEmitter)();

    expect(instance.listenerCount('ping')).toBe(0);
    instance.emit('ping');
    expect(inherited).not.toHaveBeenCalled();

    const own = vi.fn();
    instance.on('ping', own);
    expect(shared.listenerCount('ping')).toBe(1);
    shared.emit('ping');
    expect(own).not.toHaveBeenCalled();
    expect(inherited).toHaveBeenCalledTimes(1);
  });
});
