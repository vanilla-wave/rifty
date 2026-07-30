import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeRefs,
  awaitDrain,
  beginNodeEvalExplicitExit,
  beginNodeEvalUnhandled,
  installUnhandledErrorTrap,
  installUnhandledRejectionTrap,
  recordRejection,
  ref,
  registerNodeEvalDrainLifecycle,
  releaseNodeEvalDrainOwnership,
  resetKeepalive,
  trackKeepalivePromise,
  unref,
} from './event-loop-keepalive.ts';

afterEach(() => {
  resetKeepalive();
  vi.useRealTimers();
});

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

  it('eval drain does not consult a guest-mutated Promise.resolve', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Promise, 'resolve');
    if (descriptor === undefined) throw new Error('Promise.resolve descriptor missing');
    const resolve = Promise.resolve.bind(Promise);
    let calls = 0;
    Object.defineProperty(Promise, 'resolve', {
      ...descriptor,
      value: (value: unknown) => {
        calls += 1;
        return resolve(value);
      },
    });
    const queue: Array<() => void> = [];
    let drain: Promise<void>;
    let interceptedCalls: number;

    try {
      registerNodeEvalDrainLifecycle({
        beforeExit: () => {},
        projectUnhandled: (reason) => reason,
        terminateUnhandled: (reason) => reason,
      });
      drain = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });
      queue.shift()!();
      interceptedCalls = calls;
    } finally {
      Object.defineProperty(Promise, 'resolve', descriptor);
    }

    await expect(drain).resolves.toBeUndefined();
    expect(interceptedCalls).toBe(0);
  });

  it('rejects the outer drain when unhandled-error projection throws', async () => {
    const marker = new Error('projection failed');
    registerNodeEvalDrainLifecycle({
      beforeExit: () => {},
      projectUnhandled: () => {
        throw marker;
      },
      terminateUnhandled: (reason) => reason,
    });
    const queue: Array<() => void> = [];
    const drain = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });
    recordRejection(new Error('guest rejection'));

    queue.shift()!();
    const outcome = await Promise.race([
      drain.then(
        () => 'resolved',
        (error: unknown) => error,
      ),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 10)),
    ]);

    expect(outcome).toBe(marker);
  });

  it('prints once before an explicit eval exit rejects the active drain', async () => {
    const events: string[] = [];
    const exit = Object.assign(new Error('process.exit(7)'), {
      code: 'RIFTY_PROCESS_EXIT',
      exitCode: 7,
    });
    registerNodeEvalDrainLifecycle({
      beforeExit: () => {
        events.push('print');
      },
      projectUnhandled: () => {
        throw new Error('explicit exit must not be projected');
      },
      terminateUnhandled: () => {
        throw new Error('active drain must own explicit exit');
      },
    });
    const queue: Array<() => void> = [];
    const drain = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });

    expect(
      beginNodeEvalExplicitExit(exit, () => {
        events.push('direct-exit');
        return exit;
      }),
    ).toBe(true);
    expect(events).toEqual([]);
    queue.shift()!();

    await expect(drain).rejects.toBe(exit);
    expect(events).toEqual(['print']);
  });

  it('prints before an explicit eval exit when no drain owns the lifecycle', async () => {
    const events: string[] = [];
    const exit = Object.assign(new Error('process.exit(7)'), {
      code: 'RIFTY_PROCESS_EXIT',
      exitCode: 7,
    });
    registerNodeEvalDrainLifecycle({
      beforeExit: async () => {
        await Promise.resolve();
        events.push('print');
      },
      projectUnhandled: (reason) => reason,
      terminateUnhandled: () => {
        throw new Error('explicit exit uses its dedicated callbacks');
      },
    });

    expect(
      beginNodeEvalExplicitExit(exit, () => {
        events.push('direct-exit');
        return exit;
      }),
    ).toBe(true);
    expect(beginNodeEvalUnhandled(new Error('later loser'), 'uncaught-error')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['print', 'direct-exit']);
  });

  it('makes a released orphan drain inert before a served error claims the lifecycle', async () => {
    const events: string[] = [];
    const queue: Array<() => void> = [];
    registerNodeEvalDrainLifecycle({
      beforeExit: () => {
        events.push('print');
      },
      projectUnhandled: (reason) => {
        events.push(`project:${(reason as Error).message}`);
        return reason;
      },
      terminateUnhandled: (reason, origin) => {
        events.push(`terminate:${origin}:${(reason as Error).message}`);
        return Object.assign(new Error('process.exit(1)'), {
          code: 'RIFTY_PROCESS_EXIT',
          exitCode: 1,
        });
      },
    });
    const orphan = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });

    releaseNodeEvalDrainOwnership();
    queue.shift()!();
    await expect(orphan).resolves.toBeUndefined();
    expect(events).toEqual([]);

    expect(beginNodeEvalUnhandled(new Error('served'), 'uncaught-error')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['print', 'project:served', 'terminate:uncaught-error:served']);
  });

  it('routes a direct eval projection failure through lifecycle-failure termination once', async () => {
    vi.useFakeTimers();
    const failure = new Error('projection failed');
    const events: string[] = [];
    registerNodeEvalDrainLifecycle({
      beforeExit: () => {
        events.push('print');
      },
      projectUnhandled: (_reason, origin) => {
        events.push(`project:${origin}`);
        throw failure;
      },
      terminateUnhandled: (reason, origin) => {
        events.push(`terminate:${origin}:${(reason as Error).message}`);
        return Object.assign(new Error('process.exit(1)'), {
          code: 'RIFTY_PROCESS_EXIT',
          exitCode: 1,
        });
      },
    });

    expect(beginNodeEvalUnhandled(new Error('served'), 'uncaught-error')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      'print',
      'project:uncaught-error',
      'terminate:lifecycle-failure:projection failed',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('routes a direct eval diagnostic failure through lifecycle-failure termination once', async () => {
    vi.useFakeTimers();
    const diagnosticFailure = new Error('diagnostic failed');
    const events: string[] = [];
    registerNodeEvalDrainLifecycle({
      beforeExit: () => {
        events.push('print');
      },
      projectUnhandled: (reason, origin) => {
        events.push(`project:${origin}`);
        return reason;
      },
      terminateUnhandled: (reason, origin) => {
        events.push(`terminate:${origin}:${(reason as Error).message}`);
        if (origin !== 'lifecycle-failure') throw diagnosticFailure;
        return Object.assign(new Error('process.exit(1)'), {
          code: 'RIFTY_PROCESS_EXIT',
          exitCode: 1,
        });
      },
    });

    expect(beginNodeEvalUnhandled(new Error('served'), 'uncaught-error')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      'print',
      'project:uncaught-error',
      'terminate:uncaught-error:served',
      'terminate:lifecycle-failure:diagnostic failed',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hands an explicit exit claimed before server release to the direct terminal path', async () => {
    const events: string[] = [];
    const queue: Array<() => void> = [];
    const exit = Object.assign(new Error('process.exit(7)'), {
      code: 'RIFTY_PROCESS_EXIT',
      exitCode: 7,
    });
    registerNodeEvalDrainLifecycle({
      beforeExit: () => {
        events.push('print');
      },
      projectUnhandled: () => {
        throw new Error('explicit exit must not be projected');
      },
      terminateUnhandled: () => {
        throw new Error('explicit exit must use its exit callback');
      },
    });
    const orphan = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });

    expect(
      beginNodeEvalExplicitExit(exit, () => {
        events.push('exit:7');
        return exit;
      }),
    ).toBe(true);
    expect(events).toEqual([]);
    releaseNodeEvalDrainOwnership();
    queue.shift()!();
    await expect(orphan).resolves.toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['print', 'exit:7']);
  });

  it('hands an error claimed before server release to the direct terminal path', async () => {
    const events: string[] = [];
    const queue: Array<() => void> = [];
    registerNodeEvalDrainLifecycle({
      beforeExit: () => {
        events.push('print');
      },
      projectUnhandled: (reason) => {
        events.push(`project:${(reason as Error).message}`);
        return reason;
      },
      terminateUnhandled: (reason, origin) => {
        events.push(`terminate:${origin}:${(reason as Error).message}`);
        return Object.assign(new Error('process.exit(1)'), {
          code: 'RIFTY_PROCESS_EXIT',
          exitCode: 1,
        });
      },
    });
    const orphan = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });

    expect(beginNodeEvalUnhandled(new Error('claimed'), 'uncaught-error')).toBe(true);
    releaseNodeEvalDrainOwnership();
    queue.shift()!();
    await expect(orphan).resolves.toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['print', 'project:claimed', 'terminate:uncaught-error:claimed']);
  });

  it('routes a direct explicit-exit print failure through the trusted lifecycle terminator', async () => {
    const failure = new Error('print failed');
    const events: string[] = [];
    const exit = Object.assign(new Error('process.exit(7)'), {
      code: 'RIFTY_PROCESS_EXIT',
      exitCode: 7,
    });
    registerNodeEvalDrainLifecycle({
      beforeExit: () => {
        throw failure;
      },
      projectUnhandled: () => {
        throw new Error('lifecycle failure must not be projected');
      },
      terminateUnhandled: (reason, origin) => {
        expect(reason).toBe(failure);
        events.push(`terminate:${origin}`);
        return Object.assign(new Error('process.exit(1)'), {
          code: 'RIFTY_PROCESS_EXIT',
          exitCode: 1,
        });
      },
    });

    expect(
      beginNodeEvalExplicitExit(exit, () => {
        events.push('exit:7');
        return exit;
      }),
    ).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['terminate:lifecycle-failure']);
  });

  it('parks a drain opened after a direct terminal has already claimed the eval', async () => {
    const events: string[] = [];
    const exit = Object.assign(new Error('process.exit(7)'), {
      code: 'RIFTY_PROCESS_EXIT',
      exitCode: 7,
    });
    registerNodeEvalDrainLifecycle({
      beforeExit: () => {
        events.push('print');
      },
      projectUnhandled: () => {
        throw new Error('explicit exit must not be projected');
      },
      terminateUnhandled: () => {
        throw new Error('explicit exit must use its exit callback');
      },
    });

    expect(
      beginNodeEvalExplicitExit(exit, () => {
        events.push('exit:7');
        return exit;
      }),
    ).toBe(true);
    const queue: Array<() => void> = [];
    let drainSettled = false;
    void awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) }).then(
      () => {
        drainSettled = true;
      },
      () => {
        drainSettled = true;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['print', 'exit:7']);
    expect(queue).toEqual([]);
    expect(drainSettled).toBe(false);
  });

  it('trackKeepalivePromise pins until a detached promise settles', async () => {
    let resolveTask!: () => void;
    trackKeepalivePromise(
      new Promise<void>((resolve) => {
        resolveTask = resolve;
      }),
    );
    expect(activeRefs()).toBe(1);
    resolveTask();
    await Promise.resolve();
    expect(activeRefs()).toBe(0);
  });

  it('trackKeepalivePromise records detached promise rejection for awaitDrain', async () => {
    trackKeepalivePromise(Promise.reject(new Error('detached boom')));
    await Promise.resolve();
    const queue: Array<() => void> = [];
    const p = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });
    queue.shift()!();
    await expect(p).rejects.toThrow('detached boom');
  });
});

describe('unhandledrejection trap', () => {
  it('records the rejection reason so awaitDrain surfaces it (does not swallow / preventDefault)', () => {
    const listeners: Record<string, (ev: unknown) => void> = {};
    const target = {
      addEventListener(type: string, cb: (ev: unknown) => void) {
        listeners[type] = cb;
      },
    };
    installUnhandledRejectionTrap(target as unknown as typeof self);
    listeners.unhandledrejection!({ reason: new Error('async boom') });
    const queue: Array<() => void> = [];
    const p = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });
    queue.shift()!();
    return expect(p).rejects.toThrow('async boom');
  });

  it('prints, projects, and terminates a served eval rejection exactly once', async () => {
    const listeners: Record<string, (ev: unknown) => void> = {};
    const target = {
      addEventListener(type: string, cb: (ev: unknown) => void) {
        listeners[type] = cb;
      },
    };
    const events: string[] = [];
    registerNodeEvalDrainLifecycle({
      beforeExit: async () => {
        await Promise.resolve();
        events.push('print');
      },
      projectUnhandled: (reason) => {
        events.push(`project:${(reason as Error).message}`);
        return reason;
      },
      terminateUnhandled: (reason, origin) => {
        events.push(`terminate:${origin}:${(reason as Error).message}`);
        return Object.assign(new Error('process.exit(1)'), {
          code: 'RIFTY_PROCESS_EXIT',
          exitCode: 1,
        });
      },
    });
    installUnhandledRejectionTrap(target as unknown as typeof self);
    let prevented = 0;
    const event = {
      reason: new Error('served rejection'),
      preventDefault: () => {
        prevented += 1;
      },
    };

    listeners.unhandledrejection!(event);
    listeners.unhandledrejection!(event);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(prevented).toBe(2);
    expect(events).toEqual([
      'print',
      'project:served rejection',
      'terminate:rejection:served rejection',
    ]);
  });
});

describe('uncaught error trap', () => {
  it('captures an eval error only while its drain can surface it', async () => {
    const listeners: Record<string, (ev: unknown) => void> = {};
    const target = {
      addEventListener(type: string, cb: (ev: unknown) => void) {
        listeners[type] = cb;
      },
    };
    const events: string[] = [];
    registerNodeEvalDrainLifecycle({
      beforeExit: () => {
        events.push('print');
      },
      projectUnhandled: (reason) => {
        events.push('project');
        return reason;
      },
      terminateUnhandled: () => {
        throw new Error('active drain must own the error');
      },
    });
    const queue: Array<() => void> = [];
    const drain = awaitDrain({ scheduleMacrotask: (cb) => queue.push(cb) });
    installUnhandledErrorTrap(target as unknown as typeof self);
    let prevented = false;

    listeners.error!({
      error: new Error('later'),
      preventDefault: () => {
        prevented = true;
      },
    });
    queue.shift()!();

    await expect(drain).rejects.toThrow('later');
    expect(prevented).toBe(true);
    expect(events).toEqual(['print', 'project']);
  });

  it('prints, projects, and terminates an error when no eval drain owns it', async () => {
    const listeners: Record<string, (ev: unknown) => void> = {};
    const target = {
      addEventListener(type: string, cb: (ev: unknown) => void) {
        listeners[type] = cb;
      },
    };
    const events: string[] = [];
    registerNodeEvalDrainLifecycle({
      beforeExit: async () => {
        await Promise.resolve();
        events.push('print');
      },
      projectUnhandled: (reason) => {
        events.push(`project:${(reason as Error).message}`);
        return reason;
      },
      terminateUnhandled: (reason, origin) => {
        events.push(`terminate:${origin}:${(reason as Error).message}`);
        return Object.assign(new Error('process.exit(1)'), {
          code: 'RIFTY_PROCESS_EXIT',
          exitCode: 1,
        });
      },
    });
    installUnhandledErrorTrap(target as unknown as typeof self);
    let prevented = false;

    listeners.error!({
      error: new Error('served later'),
      preventDefault: () => {
        prevented = true;
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(prevented).toBe(true);
    expect(events).toEqual([
      'print',
      'project:served later',
      'terminate:uncaught-error:served later',
    ]);
  });

  it('claims a primitive thrown value without replacing it with the event message', async () => {
    const reasons: unknown[] = [];
    registerNodeEvalDrainLifecycle({
      beforeExit: () => {},
      projectUnhandled: (reason) => reason,
      terminateUnhandled: (reason) => {
        reasons.push(reason);
        return Object.assign(new Error('process.exit(1)'), {
          code: 'RIFTY_PROCESS_EXIT',
          exitCode: 1,
        });
      },
    });

    expect(beginNodeEvalUnhandled(undefined, 'uncaught-error')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(reasons).toEqual([undefined]);
  });
});
