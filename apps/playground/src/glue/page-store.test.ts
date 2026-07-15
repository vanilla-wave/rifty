import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createPageStore } from './page-store.ts';
import type { ProjectIndex } from './project-index.ts';

const SAMPLE: ProjectIndex = {
  activeId: 'p-1',
  scratch: { starter: 'project-files', dirty: true, editedAt: '2026-06-21T00:00:00.000Z' },
  projects: [{ id: 'p-1', name: 'A', starter: 'real-vite', editedAt: '2026-06-21T00:00:00.000Z' }],
};

describe('createPageStore (ADR-0165 page store)', () => {
  it('starts at the scratch defaults (durable fields)', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      expect(s.activeId()).toBe('scratch');
      expect(s.projects()).toEqual([]);
      expect(s.scratch()).toBeNull();
      expect(s.dirty()).toBe(false);
      expect(s.storage()).toBe('opfs');
      expect(s.launcherOpen()).toBe(false);
      dispose();
    });
  });

  it('hydrateIndex folds an owner-published ProjectIndex into activeId/projects/scratch', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex(SAMPLE);
      expect(s.activeId()).toBe('p-1');
      expect(s.projects()).toHaveLength(1);
      expect(s.projects()[0]).toMatchObject({ id: 'p-1', name: 'A' });
      expect(s.scratch()).toMatchObject({ starter: 'project-files', dirty: true });
      dispose();
    });
  });

  it('hydrateIndex preserves a local boot scratch when a scratch-active index lacks one (ADR-0165 §4)', () => {
    // The OWNER does not model the active scratch in its on-disk index until a
    // Save, so a cold-boot publish is `scratch:null, activeId:'scratch'` — yet
    // `/scratch` exists on disk. The store must NOT null out the boot scratch then.
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({
        activeId: 'scratch',
        scratch: { starter: 'project-files', dirty: false, editedAt: 'no edits yet' },
        projects: [],
      });
      // Owner re-publishes a cold index (no scratch entry, still scratch-active).
      s.hydrateIndex({ activeId: 'scratch', scratch: null, projects: [] });
      expect(s.activeId()).toBe('scratch');
      expect(s.scratch()).toMatchObject({ starter: 'project-files' }); // preserved
      dispose();
    });
  });

  it('hydrateIndex still clears the scratch when the index switches active to a project', () => {
    // A published scratch:null with a PROJECT active is authoritative — the scratch
    // is gone (e.g. consumed by a Save), so the preserve must not apply.
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({
        activeId: 'scratch',
        scratch: { starter: 'react', dirty: false, editedAt: 'no edits yet' },
        projects: [{ id: 'p1', name: 'A', starter: 'react', editedAt: 'now' }],
      });
      s.hydrateIndex({
        activeId: 'p1',
        scratch: null,
        projects: [{ id: 'p1', name: 'A', starter: 'react', editedAt: 'now' }],
      });
      expect(s.activeId()).toBe('p1');
      expect(s.scratch()).toBeNull(); // cleared
      dispose();
    });
  });

  it('hydrateIndex does not let a late clean owner publish erase a local dirty scratch', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({
        activeId: 'scratch',
        scratch: { starter: 'node-worker', dirty: false, editedAt: 'no edits yet' },
        projects: [{ id: 'p1', name: 'Alpha', starter: 'project-files', editedAt: 'now' }],
      });
      s.markDirty();

      s.hydrateIndex({
        activeId: 'scratch',
        scratch: { starter: 'node-worker', dirty: false, editedAt: 'no edits yet' },
        projects: [{ id: 'p1', name: 'Alpha', starter: 'project-files', editedAt: 'now' }],
      });

      expect(s.dirty()).toBe(true);
      s.requestSwitch('p1');
      expect(s.dialog()).toEqual({ kind: 'switch', pendingId: 'p1' });
      dispose();
    });
  });

  it('hydrateIndex does not let a late stale owner publish erase a local starter pick', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({
        activeId: 'scratch',
        scratch: { starter: 'project-files', dirty: false, editedAt: 'no edits yet' },
        projects: [],
      });

      s.pickStarter('typescript-ls');
      s.hydrateIndex({
        activeId: 'scratch',
        scratch: { starter: 'project-files', dirty: false, editedAt: 'no edits yet' },
        projects: [],
      });

      expect(s.scratch()).toMatchObject({ starter: 'typescript-ls', dirty: false });

      s.hydrateIndex({
        activeId: 'scratch',
        scratch: { starter: 'typescript-ls', dirty: false, editedAt: 'no edits yet' },
        projects: [],
      });
      expect(s.scratch()).toMatchObject({ starter: 'typescript-ls', dirty: false });
      dispose();
    });
  });

  it('setters mutate the persisted fields reactively; dirty() is DERIVED from the active scratch', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({
        activeId: 'scratch',
        scratch: { starter: 'react', dirty: false, editedAt: 'no edits yet' },
        projects: [],
      });
      s.markDirty(); // real owner-write signal → active scratch dirty
      expect(s.dirty()).toBe(true);
      s.setStorage('memory');
      s.openLauncher();
      s.setActiveId('p-9'); // active is a project now → not dirty (named projects autosave)
      expect(s.dirty()).toBe(false);
      expect(s.activeId()).toBe('p-9');
      expect(s.storage()).toBe('memory');
      expect(s.launcherOpen()).toBe(true);
      dispose();
    });
  });

  it('ephemeral UI setters are independent of the persisted fields', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.setLauncherTab('starters');
      s.setDialog({ kind: 'save', defaultName: 'My App' });
      s.setToast({ kind: 'info', text: 'saved' });
      s.setQ('exp');
      expect(s.launcherTab()).toBe('starters');
      expect(s.dialog()).toMatchObject({ kind: 'save' });
      expect(s.toast()).toMatchObject({ text: 'saved' });
      expect(s.q()).toBe('exp');
      // ephemeral UI did not touch durable state
      expect(s.activeId()).toBe('scratch');
      dispose();
    });
  });
});

describe('page-store pick/create (ADR-0165 §9)', () => {
  it('pickStarter with no dirty scratch creates a fresh scratch + toast, closes launcher', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.openLauncher();
      s.pickStarter('react');
      expect(s.scratch()).toEqual({ starter: 'react', dirty: false, editedAt: 'no edits yet' });
      expect(s.activeId()).toBe('scratch');
      expect(s.launcherOpen()).toBe(false);
      expect(s.dialog()).toBeNull();
      expect(s.toast()?.text).toContain('New scratch');
      dispose();
    });
  });

  it('pickStarter with a DIRTY scratch opens the switch dialog (pendingStarter), scratch unchanged', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({
        activeId: 'scratch',
        scratch: { starter: 'vue', dirty: true, editedAt: 'edited just now' },
        projects: [],
      });
      s.pickStarter('react');
      expect(s.dialog()).toEqual({ kind: 'switch', pendingStarter: 'react' });
      expect(s.scratch()?.starter).toBe('vue'); // unchanged until resolved
      dispose();
    });
  });
});

describe('page-store switch + dirty (ADR-0165 §9/§57)', () => {
  const withProjects: ProjectIndex = {
    activeId: 'scratch',
    scratch: { starter: 'react', dirty: false, editedAt: 'no edits yet' },
    projects: [{ id: 'p1', name: 'node-api', starter: 'node', editedAt: '4m ago' }],
  };

  it('requestSwitch to a project from a CLEAN scratch switches immediately + toast', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex(withProjects);
      s.openLauncher();
      s.requestSwitch('p1');
      expect(s.activeId()).toBe('p1');
      expect(s.launcherOpen()).toBe(false);
      expect(s.toast()?.text).toContain('Switched to');
      dispose();
    });
  });

  it('requestSwitch to a project from a DIRTY scratch opens switch dialog (pendingId)', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({
        ...withProjects,
        scratch: { starter: 'react', dirty: true, editedAt: 'edited just now' },
      });
      s.requestSwitch('p1');
      expect(s.dialog()).toEqual({ kind: 'switch', pendingId: 'p1' });
      expect(s.activeId()).toBe('scratch'); // unchanged
      dispose();
    });
  });

  it('confirmSwitchTo flips activeId even from a DIRTY scratch (resolved switch dialog, no re-prompt)', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({
        ...withProjects,
        scratch: { starter: 'react', dirty: true, editedAt: 'edited just now' },
      });
      s.openDialog({ kind: 'switch', pendingId: 'p1' });
      // The user confirmed Discard → confirmSwitchTo must NOT re-open the dialog
      // (the bug) and MUST flip activeId so switchTo respawns at the right root.
      s.confirmSwitchTo('p1');
      expect(s.activeId()).toBe('p1');
      expect(s.dialog()).toBeNull();
      dispose();
    });
  });

  it('confirmPickStarter spins a fresh scratch even from a DIRTY scratch (resolved switch dialog)', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({
        ...withProjects,
        scratch: { starter: 'react', dirty: true, editedAt: 'edited just now' },
      });
      s.openDialog({ kind: 'switch', pendingStarter: 'vue' });
      s.confirmPickStarter('vue');
      expect(s.activeId()).toBe('scratch');
      expect(s.scratch()).toEqual({ starter: 'vue', dirty: false, editedAt: 'no edits yet' });
      expect(s.dialog()).toBeNull();
      dispose();
    });
  });

  it('markDirty flips the active scratch dirty (real owner write, not a UI counter)', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex(withProjects);
      s.markDirty();
      expect(s.scratch()).toMatchObject({ dirty: true, editedAt: 'edited just now' });
      expect(s.toast()).toBeNull(); // scratch dirty is silent
      dispose();
    });
  });

  it('markDirty on a NAMED active project autosaves: bumps editedAt + subtle toast, never dirty', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({ ...withProjects, activeId: 'p1' });
      s.markDirty();
      expect(s.projects().find((p) => p.id === 'p1')?.editedAt).toBe('just now');
      expect(s.toast()?.text).toContain('Autosaved');
      dispose();
    });
  });
});

// ADAPTED to the committed (signal-accessor) store idiom: the canonical store
// here uses `createPageStore()` + `hydrateIndex`, accessor getters
// (`s.activeId()`/`s.scratch()`/`s.projects()`/`s.toast()`/`s.dialog()`), toast
// `{kind,text}` (extended with `undo` for the delete affordance), and dialog
// `{kind}` (extended with `delete`/`reset` carrying `id`). The plan's Task-4
// literal (`createPageStore({index})`, `s.state.*`, toast `{msg}`,
// dialog `{type,pendingId}`) describes a different store dialect that Tasks 2/3
// did NOT build; the behavioral contract (save->named, rename, delete+fallback
// +Undo tombstone, undoDelete restores) is preserved exactly.
describe('page-store save/rename/reset/delete (ADR-0165 §9)', () => {
  const dirtyScratch: ProjectIndex = {
    activeId: 'scratch',
    scratch: { starter: 'react', dirty: true, editedAt: 'edited just now' },
    projects: [{ id: 'p1', name: 'node-api', starter: 'node', editedAt: '4m ago' }],
  };

  it('confirmSave converts scratch->named project, scratch=null, new project active', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex(dirtyScratch);
      const intent = { kind: 'save', defaultName: 'react-starter' } as const;
      s.openDialog(intent);
      s.confirmSave('react-starter', 'p2', intent);
      expect(s.scratch()).toBeNull();
      const created = s.projects().find((p) => p.name === 'react-starter');
      expect(created?.id).toBe('p2');
      expect(s.activeId()).toBe('p2');
      expect(s.toast()?.text).toContain('Saved as react-starter');
      dispose();
    });
  });

  it('concurrent-same-key: late Save preserves a newer dialog', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex(dirtyScratch);
      const save = { kind: 'save', defaultName: 'react-starter' } as const;
      const rename = { kind: 'rename', id: 'p1', current: 'node-api' } as const;
      s.openDialog(save);
      s.openDialog(rename);

      s.confirmSave('react-starter', 'p2', save);

      expect(s.activeId()).toBe('p2');
      expect(s.projects().find((p) => p.id === 'p2')?.name).toBe('react-starter');
      expect(s.dialog()).toBe(rename);
      dispose();
    });
  });

  it('confirmRename updates the name + toast', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex(dirtyScratch);
      const intent = { kind: 'rename', id: 'p1', current: 'node-api' } as const;
      s.openDialog(intent);
      s.confirmRename('p1', 'renamed-api', intent);
      expect(s.projects().find((p) => p.id === 'p1')?.name).toBe('renamed-api');
      expect(s.toast()?.text).toContain('Renamed');
      dispose();
    });
  });

  it('concurrent-same-key: late Rename preserves a newer dialog', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({
        ...dirtyScratch,
        projects: [
          ...dirtyScratch.projects,
          { id: 'p2', name: 'second', starter: 'react', editedAt: 'now' },
        ],
      });
      const first = { kind: 'rename', id: 'p1', current: 'node-api' } as const;
      const second = { kind: 'rename', id: 'p2', current: 'second' } as const;
      s.openDialog(first);
      s.openDialog(second);

      s.confirmRename('p1', 'renamed-api', first);

      expect(s.projects().find((p) => p.id === 'p1')?.name).toBe('renamed-api');
      expect(s.projects().find((p) => p.id === 'p2')?.name).toBe('second');
      expect(s.dialog()).toBe(second);
      dispose();
    });
  });

  it('concurrent-same-key: late Reset preserves a newer dialog', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex(dirtyScratch);
      const reset = { kind: 'reset', id: 'p1' } as const;
      const rename = { kind: 'rename', id: 'p1', current: 'node-api' } as const;
      s.openDialog(reset);
      s.openDialog(rename);

      s.confirmReset('p1', reset);

      expect(s.projects().find((p) => p.id === 'p1')?.editedAt).toBe('just now');
      expect(s.dialog()).toBe(rename);
      dispose();
    });
  });

  it('confirmDelete removes the project, falls back to scratch, toast carries Undo', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({ ...dirtyScratch, activeId: 'p1' });
      s.openDialog({ kind: 'delete', id: 'p1' });
      s.confirmDelete();
      expect(s.projects().find((p) => p.id === 'p1')).toBeUndefined();
      expect(s.activeId()).toBe('scratch');
      expect(s.toast()).toMatchObject({ undo: true });
      dispose();
    });
  });

  it('undoDelete restores the removed project', () => {
    createRoot((dispose) => {
      const s = createPageStore();
      s.hydrateIndex({ ...dirtyScratch, activeId: 'p1' });
      s.openDialog({ kind: 'delete', id: 'p1' });
      s.confirmDelete();
      s.undoDelete();
      expect(s.projects().find((p) => p.id === 'p1')?.name).toBe('node-api');
      expect(s.toast()?.text).toContain('Restored');
      dispose();
    });
  });
});
