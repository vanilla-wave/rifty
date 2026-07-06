import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ResetRefreshDeps, createResetRefresh } from './reset-refresh.ts';

// Behavioral heirs of the retired App.test reset/rename greps (epic
// playground-testable-core, slice 4b). Fakes are the App-side ports only.

function harness(overrides: Partial<ResetRefreshDeps> = {}) {
  const snapshotSubs = new Set<() => void>();
  const deps = {
    store: {
      activeId: vi.fn(() => 'scratch' as string),
      dialog: vi.fn(() => null as { kind: string; id?: string } | null),
      confirmReset: vi.fn(),
      confirmRename: vi.fn(),
    },
    devServer: {
      sessionId: vi.fn(() => 't1' as string | null),
      lifecycleRunning: vi.fn(() => false),
      restart: vi.fn(),
    },
    ownerUnavailable: vi.fn(() => false),
    subscribeSnapshot: vi.fn((cb: () => void) => {
      snapshotSubs.add(cb);
      return () => snapshotSubs.delete(cb);
    }),
    requestSnapshot: vi.fn(),
    resetEditorInitialFiles: vi.fn(),
    flushEditorWrites: vi.fn(async () => {}),
    ephemeral: vi.fn(() => false),
    activeStarterId: vi.fn(() => 'react'),
    resetScratchIndex: vi.fn(async (_starter: string) => {}),
    resetProjectIndex: vi.fn(async (_id: string) => {}),
    renameProjectIndex: vi.fn(async (_id: string, _name: string) => {}),
  };
  Object.assign(deps, overrides);
  const publishFrame = (): void => {
    for (const cb of [...snapshotSubs]) cb();
  };
  return { deps, publishFrame, snapshotSubs, flow: createResetRefresh(deps as ResetRefreshDeps) };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('waitForActiveSnapshotFrame', () => {
  it('requests a republish and resolves on the next applied frame (subscription dropped)', async () => {
    const h = harness();
    const wait = h.flow.waitForActiveSnapshotFrame();
    expect(h.deps.requestSnapshot).toHaveBeenCalledTimes(1);
    expect(h.snapshotSubs.size).toBe(1);
    h.publishFrame();
    await wait;
    expect(h.snapshotSubs.size).toBe(0); // no leaked subscription
  });

  it('never hangs on a lost republish — bounded by the frame timeout', async () => {
    const h = harness();
    const resolved = vi.fn();
    void h.flow.waitForActiveSnapshotFrame().then(resolved);
    await settle();
    expect(resolved).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    await settle();
    expect(resolved).toHaveBeenCalled();
    expect(h.snapshotSubs.size).toBe(0);
  });

  it('skips the wait entirely while no live owner channel exists (hidden boot)', async () => {
    const h = harness({ ownerUnavailable: () => true });
    await h.flow.waitForActiveSnapshotFrame();
    expect(h.deps.requestSnapshot).not.toHaveBeenCalled();
    expect(h.deps.subscribeSnapshot).not.toHaveBeenCalled();
  });
});

describe('refreshActiveAfterReset (ADR-0165 §6 live refresh)', () => {
  it('waits for a fresh frame BEFORE reopening the initial tabs', async () => {
    const order: string[] = [];
    const h = harness();
    h.deps.resetEditorInitialFiles.mockImplementation(() => order.push('tabs'));
    const run = h.flow.refreshActiveAfterReset();
    await settle();
    expect(order).toEqual([]); // gated on the snapshot frame
    h.publishFrame();
    await run;
    expect(order).toEqual(['tabs']);
  });

  it('reboots the dev server only when the lifecycle owns a running session', async () => {
    const h = harness({});
    h.deps.devServer.lifecycleRunning.mockReturnValue(true);
    const run = h.flow.refreshActiveAfterReset();
    h.publishFrame();
    await run;
    expect(h.deps.devServer.restart).toHaveBeenCalledWith('t1');
  });

  it('leaves a stopped (or unowned) dev server alone', async () => {
    const h = harness();
    h.deps.devServer.lifecycleRunning.mockReturnValue(false);
    const stopped = h.flow.refreshActiveAfterReset();
    h.publishFrame();
    await stopped;
    h.deps.devServer.lifecycleRunning.mockReturnValue(true);
    h.deps.devServer.sessionId.mockReturnValue(null);
    const unowned = h.flow.refreshActiveAfterReset();
    h.publishFrame();
    await unowned;
    expect(h.deps.devServer.restart).not.toHaveBeenCalled();
  });
});

describe('confirmReset (ADR-0165 §6 real on-disk re-seed)', () => {
  it('flushes pending edits, re-seeds the scratch index, then flips the mirror — in order', async () => {
    const order: string[] = [];
    const h = harness();
    h.deps.store.dialog.mockReturnValue({ kind: 'reset', id: 'scratch' });
    h.deps.flushEditorWrites.mockImplementation(async () => {
      order.push('flush');
    });
    h.deps.resetScratchIndex.mockImplementation(async (starter: string) => {
      order.push(`seed:${starter}`);
    });
    h.deps.store.confirmReset.mockImplementation(() => order.push('flip'));
    h.flow.confirmReset();
    h.publishFrame();
    await settle();
    expect(order).toEqual(['flush', 'seed:react', 'flip']);
  });

  it('a named project resets through the project index post', async () => {
    const h = harness();
    h.deps.store.activeId.mockReturnValue('p-other');
    h.deps.store.dialog.mockReturnValue({ kind: 'reset', id: 'p-1' });
    h.flow.confirmReset();
    await settle();
    expect(h.deps.resetProjectIndex).toHaveBeenCalledWith('p-1');
    expect(h.deps.resetScratchIndex).not.toHaveBeenCalled();
  });

  it('refreshes the live editor + dev server ONLY when the reset target is the active root', async () => {
    const h = harness();
    // Non-active target: no snapshot wait, no tab reset.
    h.deps.store.activeId.mockReturnValue('p-other');
    h.deps.store.dialog.mockReturnValue({ kind: 'reset', id: 'p-1' });
    h.flow.confirmReset();
    await settle();
    expect(h.deps.resetEditorInitialFiles).not.toHaveBeenCalled();
    // Active target: fresh frame → tabs reopen.
    h.deps.store.activeId.mockReturnValue('p-1');
    h.flow.confirmReset();
    await settle();
    h.publishFrame();
    await settle();
    expect(h.deps.resetEditorInitialFiles).toHaveBeenCalledTimes(1);
  });

  it('memory mode skips the durable post but still flips the mirror + refreshes', async () => {
    const h = harness({ ephemeral: () => true });
    h.deps.store.dialog.mockReturnValue({ kind: 'reset', id: 'scratch' });
    h.flow.confirmReset();
    await settle();
    h.publishFrame();
    await settle();
    expect(h.deps.resetScratchIndex).not.toHaveBeenCalled();
    expect(h.deps.store.confirmReset).toHaveBeenCalled();
    expect(h.deps.resetEditorInitialFiles).toHaveBeenCalled();
  });

  it('a failed durable re-seed is loud and never flips the mirror over a wrong tree', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness({
      resetScratchIndex: async () => {
        throw new Error('owner refused');
      },
    });
    h.deps.store.dialog.mockReturnValue({ kind: 'reset', id: 'scratch' });
    h.flow.confirmReset();
    await settle();
    expect(h.deps.store.confirmReset).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[project-index] reset failed', expect.any(Error));
    error.mockRestore();
  });
});

describe('confirmRename', () => {
  it('posts the durable rename with the dialog id BEFORE the mirror flip, trimmed', async () => {
    const order: string[] = [];
    const h = harness();
    h.deps.store.dialog.mockReturnValue({ kind: 'rename', id: 'p-1' });
    h.deps.renameProjectIndex.mockImplementation(async (id: string, name: string) => {
      order.push(`post:${id}:${name}`);
    });
    h.deps.store.confirmRename.mockImplementation((name: string) => order.push(`flip:${name}`));
    h.flow.confirmRename('  New Name ');
    await settle();
    // durable post gets the TRIMMED name; the mirror flip receives the raw input
    expect(order).toEqual(['post:p-1:New Name', 'flip:  New Name ']);
  });

  it('a blank name or a non-rename dialog still flips the mirror but posts nothing', async () => {
    const h = harness();
    h.deps.store.dialog.mockReturnValue({ kind: 'rename', id: 'p-1' });
    h.flow.confirmRename('   ');
    // id present but kind ≠ rename: only the RENAME dialog's target posts.
    h.deps.store.dialog.mockReturnValue({ kind: 'reset', id: 'p-1' });
    h.flow.confirmRename('name');
    await settle();
    expect(h.deps.renameProjectIndex).not.toHaveBeenCalled();
    expect(h.deps.store.confirmRename).toHaveBeenCalledTimes(2);
  });

  it('memory mode never posts a durable rename (page-mirror only)', async () => {
    const h = harness({ ephemeral: () => true });
    h.deps.store.dialog.mockReturnValue({ kind: 'rename', id: 'p-1' });
    h.flow.confirmRename('name');
    await settle();
    expect(h.deps.renameProjectIndex).not.toHaveBeenCalled();
    expect(h.deps.store.confirmRename).toHaveBeenCalledWith('name');
  });
});
