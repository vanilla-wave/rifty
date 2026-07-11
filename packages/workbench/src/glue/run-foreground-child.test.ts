import type { CommandContext } from '@riftydev/shell';
import { describe, expect, it, vi } from 'vitest';
import { runForegroundChild } from './run-foreground-child.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function foregroundHarness(faults: { readonly write?: Error; readonly end?: Error } = {}) {
  const listeners = new Map<string, Array<(value?: unknown) => void>>();
  const stdinListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const writes: Uint8Array[] = [];
  let ended = 0;
  const kill = vi.fn((_signal?: string) => true);
  const writer = {
    write(
      chunk: unknown,
      encodingOrCallback?: string | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) {
      if (!(chunk instanceof Uint8Array)) throw new Error('expected byte stdin chunk');
      writes.push(chunk.slice());
      const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      done?.(faults.write);
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
      if (current)
        stdinListeners.set(
          event,
          current.filter((candidate) => candidate !== listener),
        );
      return writer;
    },
  };
  const handle = {
    stdout: () => ({ on: (_event: 'data', _listener: (chunk: unknown) => void) => undefined }),
    stderr: () => ({ on: (_event: 'data', _listener: (chunk: unknown) => void) => undefined }),
    stdin: () => writer,
    on(event: 'exit' | 'message', listener: (value?: unknown) => void) {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
    },
    resize: () => true,
    kill,
  };
  return {
    handle,
    writes,
    kill,
    ended: () => ended,
    emitExit(code: number) {
      for (const listener of listeners.get('exit') ?? []) listener(code);
    },
  };
}

function context(stdin: CommandContext['stdin'], overrides: Partial<CommandContext> = {}) {
  return {
    cwd: '/workspace',
    env: {},
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    stdin,
    ...overrides,
  } satisfies CommandContext;
}

describe('foreground child stdin pump', () => {
  it('forwards every source chunk in order and closes child stdin at source EOF', async () => {
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

  it('stops a pending source read on child exit and never writes its late result', async () => {
    const h = foregroundHarness();
    const pending = deferred<Uint8Array | null>();
    const read = vi.fn(() => pending.promise);
    const run = runForegroundChild(h.handle, context({ read }));

    try {
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      h.emitExit(0);
      await expect(run).resolves.toBe(0);
      pending.resolve(encoder.encode('late'));
      await Promise.resolve();
      await Promise.resolve();
      expect(h.writes).toEqual([]);
      expect(h.ended()).toBe(0);
    } finally {
      pending.resolve(null);
      h.emitExit(0);
      await run;
    }
  });

  it('rejects loudly and terminates the child when the stdin source fails', async () => {
    const h = foregroundHarness();
    const onExit = vi.fn();
    const run = runForegroundChild(
      h.handle,
      context({ read: async () => Promise.reject(new Error('stdin source failed')) }),
      { onExit },
    );
    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
    void run.then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );

    try {
      await vi.waitFor(() => expect(outcome).toBe('rejected'));
      await expect(run).rejects.toThrow('stdin source failed');
      expect(h.kill).toHaveBeenCalledWith('SIGTERM');
      expect(onExit).toHaveBeenCalledOnce();
    } finally {
      h.emitExit(1);
      await run.catch(() => {});
    }
  });

  it.each([
    ['write', { write: new Error('child stdin write failed') }],
    ['end', { end: new Error('child stdin end failed') }],
  ] as const)(
    'rejects loudly and terminates the child when stdin %s fails',
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

      await expect(run).rejects.toThrow(fault.write?.message ?? fault.end?.message);
      expect(h.kill).toHaveBeenCalledWith('SIGTERM');
      expect(onExit).toHaveBeenCalledOnce();
    },
  );
});
