import { describe, expect, it, vi } from 'vitest';
import {
  type EntryLifecycleDeps,
  type KernelDrainHook,
  type WorkerSpawnSpec,
  getKernelDrainHook,
  runEntryLifecycle,
  setKernelDrainHook,
} from '../src/worker-entry.ts';

describe('kernel drain hook', () => {
  it('registers and reads back the drain hook (idempotent replace, null unregisters)', () => {
    const hook: KernelDrainHook = async () => {};
    setKernelDrainHook(hook);
    expect(getKernelDrainHook()).toBe(hook);
    setKernelDrainHook(null);
    expect(getKernelDrainHook()).toBeNull();
  });
});

/**
 * The load-bearing drain decision (serve-skip / await-drain / reject→exit1) is
 * the realm-independent `runEntryLifecycle` — extracted so it is unit-testable
 * without a Worker realm or the COI-gated SAB path (mirrors `finalizeWorkerEntry`;
 * the COI-only e2e is declared not-parity-coverable by the test-coverage-debt
 * ledger). Review S1.
 */

function makeSpec(serve: boolean | undefined): WorkerSpawnSpec {
  return {
    entry: { kind: 'source', code: '', sourceUrl: 'x' },
    argv: [],
    env: {},
    cwd: '/',
    stdio: {} as WorkerSpawnSpec['stdio'],
    syncRing: new SharedArrayBuffer(64),
    pid: 2,
    ppid: 1,
    serve,
  } as unknown as WorkerSpawnSpec;
}

function makeDeps(
  over: Partial<EntryLifecycleDeps> = {},
): EntryLifecycleDeps & { writeStderr: ReturnType<typeof vi.fn> } {
  const writeStderr = vi.fn();
  return {
    preEntryHook: null,
    drainHook: null,
    runEntry: async () => {},
    ...over,
    writeStderr,
  };
}

describe('runEntryLifecycle drain branch (child-realm-async-lifecycle)', () => {
  it('skips the drain hook for a serve worker (kept alive, never drain-reaped)', async () => {
    const drainHook = vi.fn<KernelDrainHook>(async () => {});
    const outcome = await runEntryLifecycle(makeSpec(true), makeDeps({ drainHook }));

    expect(drainHook).not.toHaveBeenCalled();
    expect(outcome).toEqual({ threw: false, code: 0 });
  });

  it('awaits the drain hook for a run-to-completion worker, then exits 0', async () => {
    const drainHook = vi.fn<KernelDrainHook>(async () => {});
    const spec = makeSpec(false);
    const outcome = await runEntryLifecycle(spec, makeDeps({ drainHook }));

    expect(drainHook).toHaveBeenCalledTimes(1);
    expect(drainHook).toHaveBeenCalledWith(spec);
    expect(outcome).toEqual({ threw: false, code: 0 });
  });

  it('a drain rejection (recorded rejection / cap timeout) fails loudly → stderr + exit 1', async () => {
    const drainHook = vi.fn<KernelDrainHook>(async () => {
      throw new Error('child realm exceeded keepalive drain cap');
    });
    const deps = makeDeps({ drainHook });
    const outcome = await runEntryLifecycle(makeSpec(false), deps);

    expect(outcome).toEqual({ threw: true, code: 1 });
    expect(deps.writeStderr).toHaveBeenCalledTimes(1);
    const written = deps.writeStderr.mock.calls[0]?.[0] as Uint8Array;
    expect(new TextDecoder().decode(written)).toContain('keepalive drain cap');
  });

  it('drains BEFORE deciding the entry succeeded — a clean entry still awaits drain', async () => {
    // Guards the ordering: a run-to-completion child that resolved its top-level
    // must not be reaped until the drain hook settles.
    const order: string[] = [];
    const deps = makeDeps({
      runEntry: async () => {
        order.push('entry');
      },
      drainHook: async () => {
        order.push('drain');
      },
    });
    await runEntryLifecycle(makeSpec(false), deps);
    expect(order).toEqual(['entry', 'drain']);
  });

  it('an entry throw is exit 1 + stderr and never reaches the drain hook', async () => {
    const drainHook = vi.fn<KernelDrainHook>(async () => {});
    const deps = makeDeps({
      drainHook,
      runEntry: async () => {
        throw new Error('entry blew up');
      },
    });
    const outcome = await runEntryLifecycle(makeSpec(false), deps);

    expect(drainHook).not.toHaveBeenCalled();
    expect(outcome).toEqual({ threw: true, code: 1 });
    expect(deps.writeStderr).toHaveBeenCalledTimes(1);
  });

  it('a RIFTY_PROCESS_EXIT carries its own code with no stderr write', async () => {
    const deps = makeDeps({
      runEntry: async () => {
        throw { code: 'RIFTY_PROCESS_EXIT', exitCode: 3 };
      },
    });
    const outcome = await runEntryLifecycle(makeSpec(false), deps);

    expect(outcome).toEqual({ threw: true, code: 3 });
    expect(deps.writeStderr).not.toHaveBeenCalled();
  });
});
