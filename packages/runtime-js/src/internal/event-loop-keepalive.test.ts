import { afterEach, describe, expect, it } from 'vitest';
import {
  activeRefs,
  awaitDrain,
  installUnhandledRejectionTrap,
  recordRejection,
  ref,
  resetKeepalive,
  unref,
} from './event-loop-keepalive.ts';

afterEach(() => resetKeepalive());

describe('event-loop keepalive', () => {
  it('ref/unref tracks active handles', () => {
    expect(activeRefs()).toBe(0);
    ref();
    ref();
    expect(activeRefs()).toBe(2);
    unref();
    expect(activeRefs()).toBe(1);
  });

  it('awaitDrain resolves once refCount reaches 0 (after a macrotask)', async () => {
    ref();
    const queue: Array<() => void> = [];
    const p = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });
    queue.shift()!(); // first tick: refCount=1, re-schedules
    unref();
    queue.shift()!(); // next tick: refCount=0 → resolves
    await expect(p).resolves.toBeUndefined();
  });

  it('awaitDrain rejects on a recorded rejection', async () => {
    ref();
    recordRejection(new Error('boom'));
    const queue: Array<() => void> = [];
    const p = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });
    queue.shift()!();
    await expect(p).rejects.toThrow('boom');
  });

  it('awaitDrain rejects with a self-explanatory cap error when it never drains', async () => {
    ref();
    let t = 0;
    const queue: Array<() => void> = [];
    const p = awaitDrain({ capMs: 10, scheduleMacrotask: (cb) => queue.push(cb), now: () => t });
    queue.shift()!(); // t=0, refCount=1 → re-schedule
    t = 50;
    queue.shift()!(); // past cap → reject
    await expect(p).rejects.toThrow(/exceeded keepalive drain cap/);
  });

  it('awaitDrain resolves on the first tick when already drained (refCount 0)', async () => {
    // No ref() — refCount stays 0
    const queue: Array<() => void> = [];
    const p = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });
    expect(queue.length).toBe(1);
    queue.shift()!(); // first tick: refCount=0 → resolves immediately
    expect(queue.length).toBe(0); // no second tick queued
    await expect(p).resolves.toBeUndefined();
  });

  it('recordRejection keeps the FIRST reason', async () => {
    ref();
    recordRejection(new Error('first'));
    recordRejection(new Error('second'));
    const queue: Array<() => void> = [];
    const p = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });
    queue.shift()!();
    await expect(p).rejects.toThrow('first');
  });
});

describe('unhandledrejection trap', () => {
  it('records the rejection reason and preventDefaults the event', () => {
    let prevented = false;
    const listeners: Record<string, (ev: unknown) => void> = {};
    const target = {
      addEventListener(type: string, cb: (ev: unknown) => void) {
        listeners[type] = cb;
      },
    };
    installUnhandledRejectionTrap(target as unknown as typeof self);
    listeners.unhandledrejection!({
      reason: new Error('async boom'),
      preventDefault() {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    const queue: Array<() => void> = [];
    const p = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });
    queue.shift()!();
    return expect(p).rejects.toThrow('async boom');
  });
});
