import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dialog, RenameDialog, ResetDialog } from '../glue/page-store.ts';
import type { ActiveId } from '../glue/project-index.ts';
import {
  type ProjectOwnerCoordinator,
  createProjectOwnerCoordinator,
} from './project-owner-coordinator.ts';
import { type ResetRefreshDeps, createResetRefresh } from './reset-refresh.ts';

// Behavioral heirs of the retired App.test reset/rename greps (epic
// playground-testable-core, slice 4b). Fakes are the App-side ports only.

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function harness(overrides: Partial<ResetRefreshDeps> = {}) {
  const snapshotSubs = new Set<() => void>();
  let dialog: Dialog = null;
  const deps = {
    store: {
      activeId: vi.fn(() => 'scratch' as string),
      dialog: vi.fn(() => dialog),
      confirmReset: vi.fn((_id: ActiveId, intent: ResetDialog) => {
        if (dialog === intent) dialog = null;
      }),
      confirmRename: vi.fn((_id: string, _name: string, intent: RenameDialog) => {
        if (dialog === intent) dialog = null;
      }),
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
    projectOwner: createProjectOwnerCoordinator(),
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
  return {
    deps,
    publishFrame,
    snapshotSubs,
    setDialog(next: Dialog): void {
      dialog = next;
    },
    flow: createResetRefresh(deps as ResetRefreshDeps),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function holdProjectOwner(projectOwner: ProjectOwnerCoordinator) {
  const started = deferred();
  const release = deferred();
  const head = projectOwner.run(
    () => true,
    async () => {
      started.resolve();
      await release.promise;
    },
  );
  await started.promise;
  return { head, release: release.resolve };
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

describe('confirmReset (ADR-0165 §6; concurrent-same-key fault)', () => {
  it('queues behind the current owner operation before flushing or binding the reset post', async () => {
    const projectOwner = createProjectOwnerCoordinator();
    const held = await holdProjectOwner(projectOwner);
    const h = harness({ projectOwner });
    const intent: ResetDialog = { kind: 'reset', id: 'p-1' };
    h.deps.store.activeId.mockReturnValue('p-other');
    h.setDialog(intent);

    h.flow.confirmReset();
    await settle();
    expect(h.deps.flushEditorWrites).not.toHaveBeenCalled();
    expect(h.deps.resetProjectIndex).not.toHaveBeenCalled();

    held.release();
    await held.head;
    await settle();
    expect(h.deps.flushEditorWrites).toHaveBeenCalledTimes(1);
    expect(h.deps.resetProjectIndex).toHaveBeenCalledWith('p-1');
    expect(h.deps.store.confirmReset).toHaveBeenCalledWith('p-1', intent);
  });

  it('skips a canceled reset intent at the queue head without binding any owner port', async () => {
    const projectOwner = createProjectOwnerCoordinator();
    const held = await holdProjectOwner(projectOwner);
    const h = harness({ projectOwner });
    h.setDialog({ kind: 'reset', id: 'p-1' });

    h.flow.confirmReset();
    h.setDialog(null);
    held.release();
    await held.head;
    await settle();

    expect(h.deps.flushEditorWrites).not.toHaveBeenCalled();
    expect(h.deps.resetProjectIndex).not.toHaveBeenCalled();
    expect(h.deps.store.confirmReset).not.toHaveBeenCalled();
  });

  it('rechecks the captured intent after the editor flush before binding the reset post', async () => {
    const flushed = deferred();
    const h = harness({ flushEditorWrites: vi.fn(() => flushed.promise) });
    const intent: ResetDialog = { kind: 'reset', id: 'p-1' };
    const replacement: ResetDialog = { kind: 'reset', id: 'p-2' };
    h.setDialog(intent);

    h.flow.confirmReset();
    await settle();
    expect(h.deps.flushEditorWrites).toHaveBeenCalledTimes(1);
    h.setDialog(replacement);
    flushed.resolve();
    await settle();

    expect(h.deps.resetProjectIndex).not.toHaveBeenCalled();
    expect(h.deps.store.confirmReset).not.toHaveBeenCalled();
    expect(h.deps.store.dialog()).toBe(replacement);
  });

  it('double confirm binds one reset because the first explicit commit retires the intent', async () => {
    const h = harness();
    const intent: ResetDialog = { kind: 'reset', id: 'p-1' };
    h.deps.store.activeId.mockReturnValue('p-other');
    h.setDialog(intent);

    h.flow.confirmReset();
    h.flow.confirmReset();
    await settle();

    expect(h.deps.resetProjectIndex).toHaveBeenCalledTimes(1);
    expect(h.deps.store.confirmReset).toHaveBeenCalledTimes(1);
    expect(h.deps.store.confirmReset).toHaveBeenCalledWith('p-1', intent);
  });

  it('flushes pending edits, re-seeds the scratch index, then flips the mirror — in order', async () => {
    const order: string[] = [];
    const h = harness();
    const intent: ResetDialog = { kind: 'reset', id: 'scratch' };
    h.setDialog(intent);
    h.deps.flushEditorWrites.mockImplementation(async () => {
      order.push('flush');
    });
    h.deps.resetScratchIndex.mockImplementation(async (starter: string) => {
      order.push(`seed:${starter}`);
    });
    h.deps.store.confirmReset.mockImplementation((id, captured) => {
      order.push(`flip:${id}:${captured === intent}`);
    });

    h.flow.confirmReset();
    await settle();
    h.publishFrame();
    await settle();
    expect(order).toEqual(['flush', 'seed:react', 'flip:scratch:true']);
  });

  it('a named project resets through the project index post with its captured identity', async () => {
    const h = harness();
    const intent: ResetDialog = { kind: 'reset', id: 'p-1' };
    h.deps.store.activeId.mockReturnValue('p-other');
    h.setDialog(intent);
    h.flow.confirmReset();
    await settle();
    expect(h.deps.resetProjectIndex).toHaveBeenCalledWith('p-1');
    expect(h.deps.resetScratchIndex).not.toHaveBeenCalled();
    expect(h.deps.store.confirmReset).toHaveBeenCalledWith('p-1', intent);
  });

  it('refreshes the live editor + dev server ONLY when the reset target is the active root', async () => {
    const h = harness();
    h.deps.store.activeId.mockReturnValue('p-other');
    h.setDialog({ kind: 'reset', id: 'p-1' });
    h.flow.confirmReset();
    await settle();
    expect(h.deps.resetEditorInitialFiles).not.toHaveBeenCalled();

    h.deps.store.activeId.mockReturnValue('p-1');
    h.setDialog({ kind: 'reset', id: 'p-1' });
    h.flow.confirmReset();
    await settle();
    h.publishFrame();
    await settle();
    expect(h.deps.resetEditorInitialFiles).toHaveBeenCalledTimes(1);
  });

  it('memory mode skips the durable post but still flips the captured mirror + refreshes', async () => {
    const h = harness({ ephemeral: () => true });
    const intent: ResetDialog = { kind: 'reset', id: 'scratch' };
    h.setDialog(intent);
    h.flow.confirmReset();
    await settle();
    h.publishFrame();
    await settle();
    expect(h.deps.resetScratchIndex).not.toHaveBeenCalled();
    expect(h.deps.store.confirmReset).toHaveBeenCalledWith('scratch', intent);
    expect(h.deps.resetEditorInitialFiles).toHaveBeenCalled();
  });

  it('a failed durable re-seed is loud and never flips the mirror over a wrong tree', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness({
      resetScratchIndex: async () => {
        throw new Error('owner refused');
      },
    });
    h.setDialog({ kind: 'reset', id: 'scratch' });
    h.flow.confirmReset();
    await settle();
    expect(h.deps.store.confirmReset).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[project-index] reset failed', expect.any(Error));
    error.mockRestore();
  });
});

describe('confirmRename (concurrent-same-key fault)', () => {
  it('queues behind the current owner operation before binding the durable rename', async () => {
    const projectOwner = createProjectOwnerCoordinator();
    const held = await holdProjectOwner(projectOwner);
    const h = harness({ projectOwner });
    const intent: RenameDialog = { kind: 'rename', id: 'p-1', current: 'Old' };
    h.setDialog(intent);

    h.flow.confirmRename('New Name');
    await settle();
    expect(h.deps.renameProjectIndex).not.toHaveBeenCalled();

    held.release();
    await held.head;
    await settle();
    expect(h.deps.renameProjectIndex).toHaveBeenCalledWith('p-1', 'New Name');
    expect(h.deps.store.confirmRename).toHaveBeenCalledWith('p-1', 'New Name', intent);
  });

  it('commits the captured rename but preserves a dialog that replaced it after owner admission', async () => {
    const renamed = deferred();
    const h = harness({ renameProjectIndex: vi.fn(() => renamed.promise) });
    const intent: RenameDialog = { kind: 'rename', id: 'p-1', current: 'Old' };
    const replacement: RenameDialog = { kind: 'rename', id: 'p-2', current: 'Other' };
    h.setDialog(intent);

    h.flow.confirmRename('  New Name ');
    await settle();
    expect(h.deps.renameProjectIndex).toHaveBeenCalledWith('p-1', 'New Name');
    h.setDialog(replacement);
    renamed.resolve();
    await settle();

    expect(h.deps.store.confirmRename).toHaveBeenCalledWith('p-1', '  New Name ', intent);
    expect(h.deps.store.dialog()).toBe(replacement);
  });

  it('double confirm binds one rename because the first explicit commit retires the intent', async () => {
    const h = harness();
    const intent: RenameDialog = { kind: 'rename', id: 'p-1', current: 'Old' };
    h.setDialog(intent);

    h.flow.confirmRename('New Name');
    h.flow.confirmRename('New Name');
    await settle();

    expect(h.deps.renameProjectIndex).toHaveBeenCalledTimes(1);
    expect(h.deps.store.confirmRename).toHaveBeenCalledTimes(1);
    expect(h.deps.store.confirmRename).toHaveBeenCalledWith('p-1', 'New Name', intent);
  });

  it('posts the durable rename with the captured id before the raw-input mirror flip', async () => {
    const order: string[] = [];
    const h = harness();
    const intent: RenameDialog = { kind: 'rename', id: 'p-1', current: 'Old' };
    h.setDialog(intent);
    h.deps.renameProjectIndex.mockImplementation(async (id: string, name: string) => {
      order.push(`post:${id}:${name}`);
    });
    h.deps.store.confirmRename.mockImplementation((id, name, captured) => {
      order.push(`flip:${id}:${name}:${captured === intent}`);
    });
    h.flow.confirmRename('  New Name ');
    await settle();
    expect(order).toEqual(['post:p-1:New Name', 'flip:p-1:  New Name :true']);
  });

  it('a blank rename closes only its own intent; a non-rename dialog is untouched', async () => {
    const h = harness();
    const rename: RenameDialog = { kind: 'rename', id: 'p-1', current: 'Old' };
    h.setDialog(rename);
    h.flow.confirmRename('   ');
    expect(h.deps.store.confirmRename).toHaveBeenCalledWith('p-1', '   ', rename);

    const reset: ResetDialog = { kind: 'reset', id: 'p-1' };
    h.setDialog(reset);
    h.flow.confirmRename('name');
    await settle();
    expect(h.deps.renameProjectIndex).not.toHaveBeenCalled();
    expect(h.deps.store.confirmRename).toHaveBeenCalledTimes(1);
    expect(h.deps.store.dialog()).toBe(reset);
  });

  it('memory mode never posts a durable rename and flips the captured mirror only', async () => {
    const h = harness({ ephemeral: () => true });
    const intent: RenameDialog = { kind: 'rename', id: 'p-1', current: 'Old' };
    h.setDialog(intent);
    h.flow.confirmRename('name');
    await settle();
    expect(h.deps.renameProjectIndex).not.toHaveBeenCalled();
    expect(h.deps.store.confirmRename).toHaveBeenCalledWith('p-1', 'name', intent);
  });
});
