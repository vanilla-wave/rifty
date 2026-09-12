/** I7 owner-ready candidate; actual adapter, clock/physical Worker boundary only. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateUrlContext, validateWorkbenchOptions } from './internal/workbench-options.ts';
import { type RawWorkspaceOwnerHandle, createWorkbenchOwnerPort } from './workbench-owner-port.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

function begin(overrides: Record<string, number> = {}) {
  vi.useFakeTimers();
  const ready = deferred<void>();
  const closed = deferred<void>();
  let closes = 0;
  const unused = (): never => {
    throw new Error('Unexpected successful-owner operation at failed-startup boundary');
  };
  const raw: RawWorkspaceOwnerHandle = {
    ready: ready.promise,
    closed: closed.promise,
    storageSnapshot: unused,
    openProject: unused,
    deleteProject: unused,
    close() {
      closes++;
    },
  };
  const port = createWorkbenchOwnerPort({ startWorkspaceOwner: () => raw });
  const validated = validateWorkbenchOptions(
    {
      deployment: {
        workers: {
          owner: './owner.js',
          kernel: './kernel.js',
          node: './node.js',
          devServer: './dev.js',
        },
        serviceWorker: { url: './sw.js', scope: '/app/' },
        wasm: { sqlite: './sqlite.wasm' },
        ...overrides,
      },
      packageAcquisition: { mode: 'snapshot-only' },
      storage: { persistence: 'ephemeral' },
    },
    validateUrlContext({
      apiBaseUrl: 'https://host.test/app/',
      clientUrl: 'https://host.test/app/index.html',
    }),
  );
  const opening = port.start({ ...validated.owner, storage: validated.storage });
  let state = 'pending';
  void opening.then(
    () => {
      state = 'resolved';
    },
    () => {
      state = 'rejected';
    },
  );
  cleanups.push(() => closed.resolve());
  return {
    opening,
    state: () => state,
    closes: () => closes,
    exit: () => closed.resolve(),
    refuse: (error: Error) => ready.reject(error),
  };
}

describe('I7 owner startup budget reaches the existing ready deadline', () => {
  it('preserves the omitted 30-second owner-ready deadline', async () => {
    const h = begin();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(h.state()).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.closes()).toBe(1);
    expect(h.state()).toBe('pending');
    h.exit();
    await expect(h.opening).rejects.toThrow(/ready timed out after 30000ms/);
    expect(h.closes()).toBe(1);
  });

  it('honors a shorter normalized B, then waits for the existing physical cleanup', async () => {
    const h = begin({ ownerStartupTimeoutMs: 10.1 });
    await vi.advanceTimersByTimeAsync(10);
    expect(h.state()).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.closes()).toBe(1);
    expect(h.state()).toBe('pending');
    h.exit();
    await expect(h.opening).rejects.toThrow(/ready timed out after 11ms/);
  });

  it('a raised B is not cut off at the old 30 seconds; native refusal remains authoritative', async () => {
    const h = begin({ ownerStartupTimeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(30_001);
    expect(h.state()).toBe('pending');
    expect(h.closes()).toBe(0);
    const refusal = new Error('Physical owner startup refused');
    h.refuse(refusal);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.closes()).toBe(1);
    expect(h.state()).toBe('pending');
    h.exit();
    await expect(h.opening).rejects.toBe(refusal);
    expect(h.closes()).toBe(1);
  });

  it('shorter F/T/S/P values do not become an owner-ready deadline', async () => {
    const h = begin({
      ownerStartupTimeoutMs: 7000,
      projectFileCommitTimeoutMs: 1,
      playgroundRequestTimeoutMs: 2,
      ownerOperationSilenceTimeoutMs: 3,
      previewProbeTimeoutMs: 4,
    });
    await vi.advanceTimersByTimeAsync(6999);
    expect(h.state()).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.closes()).toBe(1);
    h.exit();
    await expect(h.opening).rejects.toThrow(/ready timed out after 7000ms/);
  });
});
