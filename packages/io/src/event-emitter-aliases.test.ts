import { describe, expect, it } from 'vitest';
import { EventEmitter } from './event-emitter.ts';

type Listener = (...args: unknown[]) => void;

// `on`/`off` stay methods in the public type: a TS subclass may override them
// and reach the base through `super` (a field-typed alias refuses both).
class Traced extends EventEmitter {
  readonly calls: string[] = [];

  override on(event: string | symbol, listener: Listener): this {
    this.calls.push(`on:${String(event)}`);
    return super.on(event, listener);
  }

  override off(event: string | symbol, listener: Listener): this {
    this.calls.push(`off:${String(event)}`);
    return super.off(event, listener);
  }
}

describe('EventEmitter on/off overrides', () => {
  it('reach the shared base functions through super; `once` registers through `on`', () => {
    const t = new Traced();
    const fn = (): void => {};
    t.on('x', fn).once('y', fn).off('x', fn);
    expect(t.calls).toEqual(['on:x', 'on:y', 'off:x']);
    expect(t.listenerCount('x')).toBe(0);
    expect(t.listenerCount('y')).toBe(1);
    expect(EventEmitter.prototype.on).toBe(EventEmitter.prototype.addListener);
  });
});
