import type { CommandContext } from '@riftydev/shell';
import { describe, expect, it, vi } from 'vitest';
import { runForegroundChild } from './run-foreground-child.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function foregroundHarness(
  faults: {
    readonly stdin?: Error;
    readonly write?: Error;
    readonly end?: Error;
    readonly deferWrites?: boolean;
    readonly kill?: Error | false;
    readonly exitOnKill?: readonly [code: number | null, signal: string | null];
  } = {},
) {
  const listeners = new Map<string, Array<(value?: unknown) => void>>();
  const stdinListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const writes: Uint8Array[] = [];
  let ended = 0;
  const emitExit = (code: number | null, signal: string | null = null): void => {
    for (const listener of listeners.get('exit') ?? []) {
      (listener as (...args: unknown[]) => void)(code, signal);
    }
  };
  const kill = vi.fn((_signal?: string) => {
    if (faults.exitOnKill) emitExit(...faults.exitOnKill);
    if (faults.kill instanceof Error) throw faults.kill;
    return faults.kill ?? true;
  });
  const resize = vi.fn((_cols: number, _rows: number) => true);
  const writeCallbacks: Array<(error?: Error | null) => void> = [];
  const writer = {
    write(chunk: unknown, callback?: (error?: Error | null) => void) {
      if (!(chunk instanceof Uint8Array)) throw new Error('expected byte stdin chunk');
      writes.push(chunk.slice());
      if (callback) {
        if (faults.deferWrites) writeCallbacks.push(callback);
        else callback(faults.write);
      }
      return true;
    },
    end() {
      ended += 1;
      queueMicrotask(() => {
        const event = faults.end ? 'error' : 'finish';
        for (const listener of stdinListeners.get(event) ?? []) listener(faults.end);
      });
      return writer;
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]): void => {
        writer.removeListener(event, wrapped);
        listener(...args);
      };
      const current = stdinListeners.get(event) ?? [];
      current.push(wrapped);
      stdinListeners.set(event, current);
      return writer;
    },
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      const current = stdinListeners.get(event);
      if (current) {
        stdinListeners.set(
          event,
          current.filter((candidate) => candidate !== listener),
        );
      }
      return writer;
    },
  };
  const stdin = vi.fn(() => {
    if (faults.stdin) throw faults.stdin;
    return writer;
  });
  const handle = {
    stdout: () => ({ on: (_event: 'data', _listener: (chunk: unknown) => void) => undefined }),
    stderr: () => ({ on: (_event: 'data', _listener: (chunk: unknown) => void) => undefined }),
    stdin,
    on(event: 'exit' | 'message', listener: (value?: unknown) => void) {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
    },
    resize,
    completeWrite(error?: Error) {
      writeCallbacks.shift()?.(error);
    },
    kill,
  };
  return {
    handle,
    writes,
    stdin,
    kill,
    resize,
    completeWrite: handle.completeWrite,
    ended: () => ended,
    emitExit,
  };
}

function context(
  stdin: CommandContext['stdin'],
  overrides: Partial<CommandContext> = {},
): CommandContext {
  return {
    cwd: '/workspace',
    env: {},
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    stdin,
    ...overrides,
  };
}

const settledOr = <T>(promise: Promise<T>, pending: T): Promise<T> =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(pending), 50))]);

describe('foreground child stdin pump', () => {
  it('preserves the exact signal-only child exit instead of projecting it to success', async () => {
    const h = foregroundHarness();
    const run = runForegroundChild(h.handle, context(undefined));

    h.emitExit(null, 'SIGTERM');

    await expect(run).resolves.toEqual({ code: null, signal: 'SIGTERM' });
  });

  it('forwards source chunks in order and ends child stdin at source EOF', async () => {
    const h = foregroundHarness();
    const chunks: Array<Uint8Array | null> = [encoder.encode('one'), encoder.encode('two'), null];
    const run = runForegroundChild(h.handle, context({ read: async () => chunks.shift() ?? null }));

    try {
      await vi.waitFor(() => {
        expect(h.writes.map((chunk) => decoder.decode(chunk))).toEqual(['one', 'two']);
        expect(h.ended()).toBe(1);
      });
    } finally {
      h.emitExit(0);
      await run;
    }
  });

  it('keeps one stdin write in flight before reading the next source chunk', async () => {
    const h = foregroundHarness({ deferWrites: true });
    const chunks: Array<Uint8Array | null> = [encoder.encode('one'), encoder.encode('two'), null];
    const read = vi.fn(async () => chunks.shift() ?? null);
    const run = runForegroundChild(h.handle, context({ read }));

    try {
      await vi.waitFor(() => expect(h.writes).toHaveLength(1));
      expect(read).toHaveBeenCalledOnce();

      h.completeWrite();
      await vi.waitFor(() => expect(h.writes).toHaveLength(2));
      expect(read).toHaveBeenCalledTimes(2);

      h.completeWrite();
      await vi.waitFor(() => expect(h.ended()).toBe(1));
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      h.emitExit(0);
      await run;
    }
  });

  it('drops a pending source read when the child exits', async () => {
    const h = foregroundHarness();
    const pending = deferred<Uint8Array | null>();
    const read = vi.fn(() => pending.promise);
    const run = runForegroundChild(h.handle, context({ read }));

    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    h.emitExit(0);
    await expect(run).resolves.toEqual({ code: 0, signal: null });

    pending.resolve(encoder.encode('late'));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.writes).toEqual([]);
    expect(h.ended()).toBe(0);
  });

  it('forwards current and live terminal dimensions and unsubscribes on exit', async () => {
    const h = foregroundHarness();
    const unsubscribe = vi.fn();
    let onResize: ((size: { cols: number; rows: number }) => void) | undefined;
    const run = runForegroundChild(
      h.handle,
      context(undefined, {
        isTTY: true,
        terminal: {
          current: () => ({ cols: 80, rows: 24 }),
          subscribe(listener) {
            onResize = listener;
            return unsubscribe;
          },
        },
      }),
    );

    expect(h.resize).toHaveBeenCalledWith(80, 24);
    onResize?.({ cols: 120, rows: 40 });
    expect(h.resize).toHaveBeenLastCalledWith(120, 40);

    h.emitExit(0);
    await expect(run).resolves.toEqual({ code: 0, signal: null });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('unbinds terminal resize immediately on abort and stays unbound through exit', async () => {
    const h = foregroundHarness();
    const abort = new AbortController();
    const unsubscribe = vi.fn();
    let onResize: ((size: { cols: number; rows: number }) => void) | undefined;
    const run = runForegroundChild(
      h.handle,
      context(undefined, {
        signal: abort.signal,
        isTTY: true,
        terminal: {
          current: () => ({ cols: 80, rows: 24 }),
          subscribe(listener) {
            onResize = listener;
            return unsubscribe;
          },
        },
      }),
    );

    expect(h.resize).toHaveBeenCalledTimes(1);
    abort.abort();
    expect(h.kill).toHaveBeenCalledWith('SIGTERM');
    expect(unsubscribe).toHaveBeenCalledOnce();

    onResize?.({ cols: 120, rows: 40 });
    expect(h.resize).toHaveBeenCalledTimes(1);

    h.emitExit(null, 'SIGTERM');
    await expect(run).resolves.toEqual({ code: null, signal: 'SIGTERM' });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('never binds terminal resize for a pre-aborted run whose kill exits later', async () => {
    const h = foregroundHarness({ stdin: new Error('closed stdin accessor') });
    const abort = new AbortController();
    abort.abort();
    const current = vi.fn(() => ({ cols: 80, rows: 24 }));
    const subscribe = vi.fn(() => () => {});
    const run = runForegroundChild(
      h.handle,
      context(
        { read: async () => new Uint8Array([1]) },
        {
          signal: abort.signal,
          isTTY: true,
          terminal: { current, subscribe },
        },
      ),
    );

    expect(h.kill).toHaveBeenCalledWith('SIGTERM');
    expect(current).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(h.resize).not.toHaveBeenCalled();
    expect(h.stdin).not.toHaveBeenCalled();

    h.emitExit(null, 'SIGTERM');
    await expect(run).resolves.toEqual({ code: null, signal: 'SIGTERM' });
  });

  it('keeps an exit emitted synchronously by abort-time kill as the terminal outcome', async () => {
    const abort = new AbortController();
    abort.abort();
    const h = foregroundHarness({ exitOnKill: [null, 'SIGTERM'] });
    const onExit = vi.fn();

    const run = runForegroundChild(h.handle, context(undefined, { signal: abort.signal }), {
      onExit,
    });

    await expect(run).resolves.toEqual({ code: null, signal: 'SIGTERM' });
    expect(h.kill).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('a natural exit that wins the abort race never sends kill', async () => {
    const h = foregroundHarness();
    const abort = new AbortController();
    const onExit = vi.fn();
    const run = runForegroundChild(h.handle, context(undefined, { signal: abort.signal }), {
      onExit,
    });

    h.emitExit(7);
    abort.abort();

    await expect(run).resolves.toEqual({ code: 7, signal: null });
    expect(h.kill).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it.each([
    ['throws', new Error('kill failed'), 'kill failed'],
    ['returns false', false, 'foreground child closed without an exit event'],
  ] as const)(
    'abort-time kill that %s rejects terminally without waiting for an exit event',
    async (_phase, killFault, expected) => {
      const h = foregroundHarness({ kill: killFault });
      const abort = new AbortController();
      const onExit = vi.fn();
      const run = runForegroundChild(h.handle, context(undefined, { signal: abort.signal }), {
        onExit,
      });
      const outcome = run.then(
        () => 'resolved',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );

      abort.abort();

      expect(await settledOr(outcome, 'pending')).toBe(expected);
      expect(onExit).not.toHaveBeenCalled();

      h.emitExit(null, 'SIGTERM');
      expect(await outcome).toBe(expected);
      expect(onExit).toHaveBeenCalledOnce();
      h.emitExit(null, 'SIGTERM');
      expect(onExit).toHaveBeenCalledOnce();
    },
  );

  it('stdin failure plus kill throw rejects both faults without waiting for exit', async () => {
    const h = foregroundHarness({ kill: new Error('kill failed') });
    const run = runForegroundChild(
      h.handle,
      context({ read: async () => Promise.reject(new Error('stdin source failed')) }),
    );
    const outcome = run.then(
      () => 'resolved' as const,
      (error: unknown) => error,
    );

    const error = await settledOr<unknown>(outcome, 'pending');

    expect(error).toBeInstanceOf(AggregateError);
    expect(
      (error as AggregateError).errors.map((fault) =>
        fault instanceof Error ? fault.message : String(fault),
      ),
    ).toEqual(['stdin source failed', 'kill failed']);
  });

  it('still kills and settles on exit when abort-time resize cleanup fails', async () => {
    const h = foregroundHarness();
    let onAbort: (() => void) | undefined;
    const signal = {
      aborted: false,
      addEventListener: (_event: 'abort', listener: () => void) => {
        onAbort = listener;
      },
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const unsubscribe = vi.fn(() => {
      throw new Error('resize unsubscribe failed');
    });
    const run = runForegroundChild(
      h.handle,
      context(undefined, {
        signal,
        isTTY: true,
        terminal: {
          current: () => ({ cols: 80, rows: 24 }),
          subscribe: () => unsubscribe,
        },
      }),
    );

    expect(() => onAbort?.()).not.toThrow();
    expect(h.kill).toHaveBeenCalledWith('SIGTERM');

    h.emitExit(1);
    await expect(run).rejects.toThrow('resize unsubscribe failed');
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('rejects and runs kill/exit cleanup once when the stdin source fails', async () => {
    const h = foregroundHarness();
    const onExit = vi.fn();
    const unsubscribe = vi.fn();
    const run = runForegroundChild(
      h.handle,
      context(
        { read: async () => Promise.reject(new Error('stdin source failed')) },
        {
          isTTY: true,
          terminal: {
            current: () => ({ cols: 80, rows: 24 }),
            subscribe: () => unsubscribe,
          },
        },
      ),
      { onExit },
    );

    const outcome = run.then(
      () => 'resolved' as const,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    await vi.waitFor(() => expect(h.kill).toHaveBeenCalledWith('SIGTERM'));
    expect(await settledOr(outcome, 'pending')).toBe('pending');
    expect(onExit).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();

    h.emitExit(1);
    await expect(run).rejects.toThrow('stdin source failed');
    expect(onExit).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it.each([
    ['write', { write: new Error('child stdin write failed') }],
    ['end', { end: new Error('child stdin end failed') }],
  ] as const)(
    'rejects and runs kill/exit cleanup once when stdin %s fails',
    async (_phase, faults) => {
      const fault: { readonly write?: Error; readonly end?: Error } = faults;
      const h = foregroundHarness(fault);
      const onExit = vi.fn();
      const chunks: Array<Uint8Array | null> =
        fault.write === undefined ? [null] : [encoder.encode('input'), null];
      const run = runForegroundChild(
        h.handle,
        context({ read: async () => chunks.shift() ?? null }),
        { onExit },
      );

      const outcome = run.then(
        () => 'resolved' as const,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      await vi.waitFor(() => expect(h.kill).toHaveBeenCalledWith('SIGTERM'));
      expect(await settledOr(outcome, 'pending')).toBe('pending');
      expect(onExit).not.toHaveBeenCalled();

      h.emitExit(1);
      await expect(run).rejects.toThrow(fault.write?.message ?? fault.end?.message);
      expect(onExit).toHaveBeenCalledOnce();
    },
  );
});
