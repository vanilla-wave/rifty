import { describe, expect, it } from 'vitest';
import { EventEmitter, captureEventEmitterListenerScope } from './index.ts';

describe('drained invocation listener scope', () => {
  it('keeps surviving original registrations, including duplicate callback identity', () => {
    const emitter = new EventEmitter();
    const calls: string[] = [];
    const original = () => {
      calls.push('original');
    };
    emitter.on('signal', original);
    const retire = captureEventEmitterListenerScope(emitter);
    emitter.on('signal', original);
    emitter.prependListener('signal', () => calls.push('new prepend'));
    emitter.once('signal', () => calls.push('new once'));
    retire();
    emitter.emit('signal');
    expect(calls).toEqual(['original']);
  });

  it('does not resurrect original once handlers or deliberate removals', () => {
    const emitter = new EventEmitter();
    let calls = 0;
    emitter.once('once', () => {
      calls += 1;
    });
    emitter.on('removed', () => {
      calls += 100;
    });
    const retire = captureEventEmitterListenerScope(emitter);
    emitter.emit('once');
    emitter.removeAllListeners('removed');
    retire();
    emitter.emit('once');
    emitter.emit('removed');
    expect(calls).toBe(1);
  });

  it('retires quietly while retaining the original meta-event handlers', () => {
    const emitter = new EventEmitter();
    const events: string[] = [];
    emitter.on('newListener', () => events.push('original new'));
    emitter.on('removeListener', () => events.push('original remove'));
    const retire = captureEventEmitterListenerScope(emitter);
    emitter.on('newListener', () => events.push('guest new'));
    emitter.on('removeListener', () => events.push('guest remove'));
    emitter.on('guest', () => events.push('guest callback'));
    events.length = 0;
    retire();
    expect(events).toEqual([]);
    emitter.emit('guest');
    expect(events).toEqual([]);
    emitter.on('after', () => {});
    expect(events).toEqual(['original new']);
  });
});
