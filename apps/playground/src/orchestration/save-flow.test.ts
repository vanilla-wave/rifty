import { describe, expect, it, vi } from 'vitest';
import type { ProjectIndex } from '../glue/project-index.ts';
import { type PendingSwitchTarget, type SaveFlowDeps, createSaveFlow } from './save-flow.ts';

// Behavioral heirs of the retired App.test save/switch greps (epic
// playground-testable-core, slice 4b). Fakes are the App-side ports only
// (store mirror, lifecycle core, owner index posts); the flow under test is real.

function indexWith(id: string): ProjectIndex {
  return { activeId: id, scratch: null, projects: [{ id, name: 'n', starter: 's', editedAt: '' }] };
}

type Harness = ReturnType<typeof harness>;

function harness(overrides: Partial<SaveFlowDeps> = {}) {
  const dialog: { current: ({ kind: string } & PendingSwitchTarget) | null } = { current: null };
  const deps = {
    store: {
      activeId: vi.fn(() => 'scratch' as string),
      dialog: () => dialog.current,
      setDialog: vi.fn((d: null) => {
        dialog.current = d;
      }),
      requestSwitch: vi.fn(),
      confirmSwitchTo: vi.fn(),
      confirmSave: vi.fn(),
    },
    workspace: {
      waitForPendingSwitch: vi.fn(async () => true),
      switchPending: vi.fn(() => false),
      trackSwitch: vi.fn(async (run: Promise<boolean>) => run),
      switchTo: vi.fn(async () => true),
      ensureStarted: vi.fn(),
    },
    pickStarterUnguarded: vi.fn(async () => {}),
    ownerRoot: vi.fn(() => '/scratch'),
    rootForId: (id: string) => (id === 'scratch' ? '/scratch' : `/projects/${id}`),
    activeStarterId: vi.fn(() => 'react'),
    ephemeral: vi.fn(() => false),
    saveIndexPhases: vi.fn((id: string, _name: string, _starter: string) => ({
      applied: Promise.resolve<ProjectIndex | null>(indexWith(id)),
      durable: Promise.resolve<ProjectIndex | null>(indexWith(id)),
    })),
    openSaveDialog: vi.fn(),
    showSaveError: vi.fn(),
    showEphemeralSaveNotice: vi.fn(),
  };
  // Mutating assign keeps the literal's Mock member types for non-overridden deps.
  Object.assign(deps, overrides);
  return { deps, dialog, flow: createSaveFlow(deps as SaveFlowDeps) };
}

async function settle(): Promise<void> {
  // Drain chained microtasks (trackSave finally + auto-switch guards).
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('confirmSave — durable post + page-mirror flip (ADR-0165 §7/§8)', () => {
  it('posts the on-disk move FIRST, reading the starter while the store is still scratch-active', async () => {
    const order: string[] = [];
    const h = harness();
    h.deps.saveIndexPhases.mockImplementation((id: string, name: string, starter: string) => {
      order.push(`post:${name}:${starter}`);
      return {
        applied: Promise.resolve(indexWith(id)),
        durable: Promise.resolve(indexWith(id)),
      };
    });
    h.deps.store.confirmSave.mockImplementation((name: string) => order.push(`flip:${name}`));

    await h.flow.confirmSave('  My App  ');
    await settle();

    // trimmed name; owner post strictly before the activeId flip; starter captured pre-flip
    expect(order).toEqual(['post:My App:react', 'flip:My App']);
    const id = h.deps.saveIndexPhases.mock.calls[0]?.[0] ?? '';
    expect(id).toMatch(/^p-/);
  });

  it('allocates a fresh collision-free project id per save', async () => {
    const h = harness();
    await h.flow.confirmSave('a');
    await h.flow.confirmSave('b');
    await settle();
    const ids = h.deps.saveIndexPhases.mock.calls.map((c) => c[0]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(h.deps.store.confirmSave).toHaveBeenNthCalledWith(1, 'a', ids[0]);
    expect(h.deps.store.confirmSave).toHaveBeenNthCalledWith(2, 'b', ids[1]);
  });

  it('a blank name is a no-op (no post, no flip)', async () => {
    const h = harness();
    await h.flow.confirmSave('   ');
    expect(h.deps.saveIndexPhases).not.toHaveBeenCalled();
    expect(h.deps.store.confirmSave).not.toHaveBeenCalled();
  });

  it('memory mode saves EPHEMERAL: no durable post, honest notice, no auto-switch', async () => {
    const h = harness({ ephemeral: () => true });
    await h.flow.confirmSave('draft');
    await settle();
    expect(h.deps.saveIndexPhases).not.toHaveBeenCalled();
    expect(h.deps.store.confirmSave).toHaveBeenCalledWith('draft', expect.stringMatching(/^p-/));
    expect(h.deps.showEphemeralSaveNotice).toHaveBeenCalledWith('draft');
    expect(h.deps.workspace.switchTo).not.toHaveBeenCalled();
  });

  it('a failed apply phase surfaces a loud Save failed toast; a durability lag only warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness({
      saveIndexPhases: () => ({
        applied: Promise.reject(new Error('owner exploded')),
        durable: Promise.reject(new Error('flush pending')),
      }),
    });
    await h.flow.confirmSave('x');
    await settle();
    expect(h.deps.showSaveError).toHaveBeenCalledWith('Save failed: owner exploded');
    // durable rejection is NOT a user-facing error (the apply already landed or errored)
    expect(h.deps.showSaveError).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    error.mockRestore();
  });
});

describe('plain-Save auto-switch (respawn the owner at the saved root)', () => {
  function autoSwitchHarness(overrides: Partial<SaveFlowDeps> = {}): Harness {
    const h = harness(overrides);
    // After confirmSave the store mirror is on the saved project.
    h.deps.store.confirmSave.mockImplementation((_n: string, id: string) => {
      h.deps.store.activeId.mockReturnValue(id);
    });
    return h;
  }

  it('switches the owner to the saved project root once the save is durable', async () => {
    const h = autoSwitchHarness();
    await h.flow.confirmSave('mine');
    await settle();
    const id = h.deps.saveIndexPhases.mock.calls[0]?.[0] ?? '';
    expect(h.deps.workspace.switchTo).toHaveBeenCalledWith(id);
    expect(h.deps.workspace.trackSwitch).toHaveBeenCalledTimes(1);
  });

  it('skips when the owner is already rooted at the saved project', async () => {
    const h = autoSwitchHarness();
    h.deps.ownerRoot.mockImplementation(() => {
      const call = h.deps.saveIndexPhases.mock.calls[0];
      return call ? `/projects/${call[0]}` : '/scratch';
    });
    await h.flow.confirmSave('mine');
    await settle();
    expect(h.deps.workspace.switchTo).not.toHaveBeenCalled();
  });

  it('skips when the user already navigated away (activeId moved on)', async () => {
    const h = autoSwitchHarness();
    h.deps.store.confirmSave.mockImplementation(() => {
      h.deps.store.activeId.mockReturnValue('p-elsewhere');
    });
    await h.flow.confirmSave('mine');
    await settle();
    expect(h.deps.workspace.switchTo).not.toHaveBeenCalled();
  });

  it('skips when another switch is already pending', async () => {
    const h = autoSwitchHarness({});
    h.deps.workspace.switchPending.mockReturnValue(true);
    await h.flow.confirmSave('mine');
    await settle();
    expect(h.deps.workspace.switchTo).not.toHaveBeenCalled();
  });

  it('skips when the save never became durable (index missing the project)', async () => {
    const h = autoSwitchHarness({
      saveIndexPhases: (id: string) => ({
        applied: Promise.resolve(indexWith(id)),
        durable: Promise.resolve<ProjectIndex | null>({
          activeId: 'scratch',
          scratch: null,
          projects: [],
        }),
      }),
    });
    await h.flow.confirmSave('mine');
    await settle();
    expect(h.deps.workspace.switchTo).not.toHaveBeenCalled();
  });

  it('a Save-then-continue stashed mid-flight suppresses the stale auto-switch', async () => {
    let releaseDurable: (index: ProjectIndex | null) => void = () => {};
    let savedId = '';
    const h = autoSwitchHarness({
      saveIndexPhases: (id: string) => {
        savedId = id;
        return {
          applied: Promise.resolve(indexWith(id)),
          durable: new Promise<ProjectIndex | null>((resolve) => {
            releaseDurable = resolve;
          }),
        };
      },
    });
    await h.flow.confirmSave('mine');
    // A switch dialog stashes a target while the auto-switch still awaits durability…
    h.dialog.current = { kind: 'switch', pendingId: 'p-next' };
    h.flow.switchSaveThen();
    releaseDurable(indexWith(savedId));
    await settle();
    // …the pending target owns the continuation; the stale auto-switch must not fire.
    expect(h.deps.workspace.switchTo).not.toHaveBeenCalledWith(savedId);
  });

  it('a launcher switch fired after Save cancels the stale auto-switch (last intent wins)', async () => {
    let releaseDurable: (index: ProjectIndex | null) => void = () => {};
    let savedId = '';
    const h = autoSwitchHarness({
      saveIndexPhases: (id: string) => {
        savedId = id;
        return {
          applied: Promise.resolve(indexWith(id)),
          durable: new Promise<ProjectIndex | null>((resolve) => {
            releaseDurable = resolve;
          }),
        };
      },
    });
    await h.flow.confirmSave('mine');
    const id = savedId;
    // The user switches elsewhere while the save durability is still in flight…
    const launcher = h.flow.launcherSwitch('p-other');
    releaseDurable(indexWith(id));
    await launcher;
    await settle();
    // …so the auto-switch must NOT fire for the saved id (only the launcher's target).
    expect(h.deps.workspace.switchTo).not.toHaveBeenCalledWith(id);
    expect(h.deps.workspace.switchTo).toHaveBeenCalledWith('p-other');
  });
});

describe('Save-then-continue / Discard-then-continue (ADR-0165 §9)', () => {
  it('switchSaveThen stashes the dialog target and opens Save; confirmSave resumes it after durable', async () => {
    const h = harness();
    h.dialog.current = { kind: 'switch', pendingId: 'p-target' };
    h.flow.switchSaveThen();
    expect(h.deps.openSaveDialog).toHaveBeenCalledTimes(1);
    expect(h.flow.pendingAfterSave()).toEqual({ pendingStarter: undefined, pendingId: 'p-target' });

    await h.flow.confirmSave('kept');
    await settle();
    // resume = UNGUARDED confirm transitions, not the dirty-guarded requestSwitch
    expect(h.deps.store.confirmSwitchTo).toHaveBeenCalledWith('p-target');
    expect(h.deps.store.requestSwitch).not.toHaveBeenCalled();
    expect(h.deps.workspace.switchTo).toHaveBeenCalledWith('p-target');
    expect(h.flow.pendingAfterSave()).toBeNull();
  });

  it('a pending starter target resumes through the unguarded eager-TS pick', async () => {
    const h = harness();
    h.dialog.current = { kind: 'switch', pendingStarter: 'vite' };
    h.flow.switchSaveThen();
    await h.flow.confirmSave('kept');
    await settle();
    expect(h.deps.pickStarterUnguarded).toHaveBeenCalledWith('vite');
    expect(h.deps.workspace.switchTo).not.toHaveBeenCalled();
  });

  it('the resume waits for durability and is dropped when the save never landed', async () => {
    const h = harness({
      saveIndexPhases: (id: string) => ({
        applied: Promise.resolve(indexWith(id)),
        durable: Promise.resolve<ProjectIndex | null>(null),
      }),
    });
    h.dialog.current = { kind: 'switch', pendingId: 'p-target' };
    h.flow.switchSaveThen();
    await h.flow.confirmSave('kept');
    await settle();
    expect(h.deps.store.confirmSwitchTo).not.toHaveBeenCalled();
    expect(h.deps.workspace.switchTo).not.toHaveBeenCalled();
  });

  it('switchDiscardThen drops the dialog and applies the target immediately', async () => {
    const h = harness();
    h.dialog.current = { kind: 'switch', pendingId: 'p-target' };
    h.flow.switchDiscardThen();
    await settle();
    expect(h.deps.store.setDialog).toHaveBeenCalledWith(null);
    expect(h.deps.store.confirmSwitchTo).toHaveBeenCalledWith('p-target');
    expect(h.deps.workspace.switchTo).toHaveBeenCalledWith('p-target');
  });

  it('switchDiscardThen continues ONLY a switch dialog — any other kind just closes', async () => {
    const h = harness();
    // pendingId present but kind ≠ switch: only the SWITCH dialog's target continues.
    h.dialog.current = { kind: 'rename', pendingId: 'p-x' };
    h.flow.switchDiscardThen();
    await settle();
    expect(h.deps.store.setDialog).toHaveBeenCalledWith(null);
    expect(h.deps.store.confirmSwitchTo).not.toHaveBeenCalled();
    expect(h.deps.pickStarterUnguarded).not.toHaveBeenCalled();
  });

  it('cancelPendingAfterSave drops the stash — a later plain Save does not resume the switch', async () => {
    const h = harness();
    h.dialog.current = { kind: 'switch', pendingId: 'p-target' };
    h.flow.switchSaveThen();
    h.flow.cancelPendingAfterSave();
    await h.flow.confirmSave('plain');
    await settle();
    expect(h.deps.store.confirmSwitchTo).not.toHaveBeenCalled();
    expect(h.deps.pickStarterUnguarded).not.toHaveBeenCalled();
  });
});

describe('launcherSwitch gates (marks a same-root open ready without respawning)', () => {
  it('a different-root unprompted switch drives the real owner respawn', async () => {
    const h = harness();
    await h.flow.launcherSwitch('p-1');
    expect(h.deps.store.requestSwitch).toHaveBeenCalledWith('p-1');
    expect(h.deps.workspace.switchTo).toHaveBeenCalledWith('p-1');
    expect(h.deps.workspace.ensureStarted).not.toHaveBeenCalled();
  });

  it('a same-root unprompted switch only marks the workspace ready (no owner respawn)', async () => {
    const h = harness({ ownerRoot: () => '/projects/p-1' });
    await h.flow.launcherSwitch('p-1');
    expect(h.deps.workspace.switchTo).not.toHaveBeenCalled();
    expect(h.deps.workspace.ensureStarted).toHaveBeenCalledWith(true);
  });

  it('a dirty-scratch prompt swallows the switch (the dialog decides)', async () => {
    const h = harness();
    h.deps.store.requestSwitch.mockImplementation(() => {
      h.dialog.current = { kind: 'switch', pendingId: 'p-1' };
    });
    await h.flow.launcherSwitch('p-1');
    expect(h.deps.workspace.switchTo).not.toHaveBeenCalled();
    expect(h.deps.workspace.ensureStarted).not.toHaveBeenCalled();
  });

  it('an unrecovered pending switch aborts before touching the store', async () => {
    const h = harness();
    h.deps.workspace.waitForPendingSwitch.mockResolvedValue(false);
    await h.flow.launcherSwitch('p-1');
    expect(h.deps.store.requestSwitch).not.toHaveBeenCalled();
  });

  it('waits out an in-flight save DURABILITY before switching (owner teardown must not race the flush)', async () => {
    let release: (index: ProjectIndex | null) => void = () => {};
    let savedId = '';
    const h = harness({
      saveIndexPhases: (id: string) => {
        savedId = id;
        return {
          applied: Promise.resolve(indexWith(id)),
          durable: new Promise<ProjectIndex | null>((resolve) => {
            release = resolve;
          }),
        };
      },
    });
    await h.flow.confirmSave('mine');
    const order: string[] = [];
    h.deps.store.requestSwitch.mockImplementation(() => order.push('switch'));
    const launcher = h.flow.launcherSwitch('p-2').then(() => order.push('done'));
    await settle();
    expect(order).toEqual([]); // gated on the durable wait
    release(indexWith(savedId));
    await launcher;
    expect(order).toEqual(['switch', 'done']);
  });
});

describe('beginStarterPick gates', () => {
  it('passes when nothing is in flight', async () => {
    const h = harness();
    await expect(h.flow.beginStarterPick()).resolves.toBe(true);
  });

  it('aborts when the pending switch cannot be recovered', async () => {
    const h = harness();
    h.deps.workspace.waitForPendingSwitch.mockResolvedValue(false);
    await expect(h.flow.beginStarterPick()).resolves.toBe(false);
  });

  it('waits for the in-flight save APPLY (not durability) and aborts when it failed', async () => {
    const h = harness({
      saveIndexPhases: (id: string) => ({
        applied: Promise.resolve<ProjectIndex | null>(null),
        durable: Promise.resolve(indexWith(id)),
      }),
    });
    await h.flow.confirmSave('mine');
    await expect(h.flow.beginStarterPick()).resolves.toBe(false);
  });
});
