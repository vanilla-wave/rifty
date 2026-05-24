import { describe, expect, it } from 'vitest';
import { EventEmitter, once } from '../../../packages/runtime-js/src/builtins/events.ts';

describe('node:events EventEmitter', () => {
  it('on/emit fires synchronously in order', () => {
    const ee = new EventEmitter();
    const log: number[] = [];
    ee.on('x', () => log.push(1));
    ee.on('x', () => log.push(2));
    ee.emit('x');
    expect(log).toEqual([1, 2]);
  });

  it('once fires only once', () => {
    const ee = new EventEmitter();
    let n = 0;
    ee.once('x', () => n++);
    ee.emit('x');
    ee.emit('x');
    expect(n).toBe(1);
  });

  it('off removes a listener', () => {
    const ee = new EventEmitter();
    const fn = () => {};
    ee.on('x', fn);
    expect(ee.listenerCount('x')).toBe(1);
    ee.off('x', fn);
    expect(ee.listenerCount('x')).toBe(0);
  });

  it('listeners added during emit do not fire for the current emit', () => {
    const ee = new EventEmitter();
    let added = 0;
    ee.on('x', () => {
      ee.on('x', () => added++);
    });
    ee.emit('x');
    expect(added).toBe(0);
    ee.emit('x');
    expect(added).toBe(1);
  });

  it('error event throws if no listener', () => {
    const ee = new EventEmitter();
    expect(() => ee.emit('error', new Error('boom'))).toThrow('boom');
  });

  it('removeAllListeners works for a specific name and globally', () => {
    const ee = new EventEmitter();
    ee.on('x', () => {});
    ee.on('y', () => {});
    ee.removeAllListeners('x');
    expect(ee.listenerCount('x')).toBe(0);
    expect(ee.listenerCount('y')).toBe(1);
    ee.removeAllListeners();
    expect(ee.listenerCount('y')).toBe(0);
  });

  it('once() promise variant resolves with emit args', async () => {
    const ee = new EventEmitter();
    setTimeout(() => ee.emit('data', 1, 2), 0);
    const args = await once(ee, 'data');
    expect(args).toEqual([1, 2]);
  });

  it('emit returns false if no listener (except error)', () => {
    const ee = new EventEmitter();
    expect(ee.emit('nope')).toBe(false);
    ee.on('y', () => {});
    expect(ee.emit('y')).toBe(true);
  });
});
