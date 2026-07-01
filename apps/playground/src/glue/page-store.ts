/**
 * Page-realm store (ADR-0165) — replaces the bare `activePreset` signal in
 * App.tsx with the multi-project shape. PAGE-side ONLY: it holds no fs handle;
 * the owner owns the OPFS index, the page hydrates this in-memory MIRROR via the
 * project-index bridge (`hydrateIndex`). Splits durable state (activeId /
 * projects / scratch / dirty / storage / launcherOpen) from ephemeral UI
 * (launcherTab / menuFor / dialog / q / cat / toast). No owner-respawn / root
 * threading here — that is the App-level switch wiring.
 */
import { type Accessor, createSignal } from 'solid-js';
import type { ActiveId, Project, ProjectIndex, Scratch } from './project-index.ts';

export type StorageKind = 'opfs' | 'memory';
export type LauncherTab = 'projects' | 'starters';
export interface SaveDialog {
  readonly kind: 'save';
  readonly defaultName: string;
}
export interface RenameDialog {
  readonly kind: 'rename';
  readonly id: string;
  readonly current: string;
}
/** Confirm-reset-to-starter prompt (scratch or a named project) (ADR-0165 §9). */
export interface ResetDialog {
  readonly kind: 'reset';
  readonly id: ActiveId;
}
/** Confirm-delete prompt for a named project (ADR-0165 §9). */
export interface DeleteDialog {
  readonly kind: 'delete';
  readonly id: string;
}
/** Confirm-switch prompt when a dirty scratch would be discarded (ADR-0165 §9). */
export interface SwitchDialog {
  readonly kind: 'switch';
  readonly pendingStarter?: string;
  readonly pendingId?: string;
}
/** Confirm-wipe-all-browser-state prompt (Projects tab · Reset sandbox). */
export interface ResetSandboxDialog {
  readonly kind: 'reset-sandbox';
}
export type Dialog =
  | SaveDialog
  | RenameDialog
  | ResetDialog
  | DeleteDialog
  | SwitchDialog
  | ResetSandboxDialog
  | null;
export interface Toast {
  readonly kind: 'info' | 'error';
  readonly text: string;
  /** Delete toast carries an Undo affordance (ADR-0165 §9 tombstone). */
  readonly undo?: boolean;
}

export interface PageStore {
  // durable (mirrors the owner ProjectIndex + boot probe)
  readonly activeId: Accessor<ActiveId>;
  readonly projects: Accessor<readonly Project[]>;
  readonly scratch: Accessor<Scratch | null>;
  readonly dirty: Accessor<boolean>;
  readonly storage: Accessor<StorageKind>;
  readonly launcherOpen: Accessor<boolean>;
  // ephemeral UI
  readonly launcherTab: Accessor<LauncherTab>;
  readonly menuFor: Accessor<string | null>;
  readonly dialog: Accessor<Dialog>;
  readonly q: Accessor<string>;
  readonly cat: Accessor<string | null>;
  readonly toast: Accessor<Toast | null>;
  // folds an owner-published index into the durable fields
  hydrateIndex(index: ProjectIndex): void;
  // transitions (ADR-0165 §9)
  pickStarter(starterId: string): void;
  requestSwitch(id: ActiveId): void;
  // UNGUARDED transitions for the switch-dialog resolution (the user already
  // confirmed Save/Discard, so these skip the dirty re-prompt — re-invoking the
  // guarded requestSwitch/pickStarter would re-open the dialog and never flip).
  confirmSwitchTo(id: ActiveId): void;
  confirmPickStarter(starterId: string): void;
  markDirty(): void;
  openDialog(d: Dialog): void;
  confirmSave(name: string, newId: string): void;
  confirmRename(name: string): void;
  confirmReset(): void;
  confirmDelete(): void;
  undoDelete(): void;
  // setters
  setActiveId(id: ActiveId): void;
  setStorage(k: StorageKind): void;
  openLauncher(): void;
  closeLauncher(): void;
  setLauncherTab(t: LauncherTab): void;
  setMenuFor(id: string | null): void;
  setDialog(d: Dialog): void;
  setQ(q: string): void;
  setCat(c: string | null): void;
  setToast(t: Toast | null): void;
}

export function createPageStore(): PageStore {
  const [activeId, setActiveId] = createSignal<ActiveId>('scratch');
  const [projects, setProjects] = createSignal<readonly Project[]>([]);
  const [scratch, setScratch] = createSignal<Scratch | null>(null);
  // DIRTY is DERIVED, not a standalone signal (ADR-0165 §57): only the active
  // unnamed scratch can be dirty (named projects autosave), so it is exactly the
  // active scratch's dirty flag — one source, never a second signal to drift.
  const dirty = (): boolean => activeId() === 'scratch' && scratch()?.dirty === true;
  const [storage, setStorage] = createSignal<StorageKind>('opfs');
  const [launcherOpen, setLauncherOpen] = createSignal(false);
  const [launcherTab, setLauncherTab] = createSignal<LauncherTab>('projects');
  const [menuFor, setMenuFor] = createSignal<string | null>(null);
  const [dialog, setDialog] = createSignal<Dialog>(null);
  const [q, setQ] = createSignal('');
  const [cat, setCat] = createSignal<string | null>(null);
  const [toast, setToast] = createSignal<Toast | null>(null);
  let pendingScratchStarter: string | null = null;

  // Fresh, unedited scratch from a Starter (baseline re-seed is owner-side; the
  // page only mirrors the index shape). Closes the launcher, drops any menu/dialog.
  function createScratch(starterId: string): void {
    pendingScratchStarter = starterId;
    setScratch({ starter: starterId, dirty: false, editedAt: 'no edits yet' });
    setActiveId('scratch');
    setLauncherOpen(false);
    setMenuFor(null);
    setDialog(null);
    setToast({ kind: 'info', text: `New scratch from ${starterId}` });
  }

  // Pick a Starter from the launcher. A DIRTY scratch would be discarded, so prompt
  // first (switch dialog carries the pendingStarter); a clean/absent scratch is
  // replaced immediately.
  function pickStarter(starterId: string): void {
    const s = scratch();
    if (s?.dirty) {
      setDialog({ kind: 'switch', pendingStarter: starterId });
      setMenuFor(null);
      return;
    }
    createScratch(starterId);
  }

  function projectById(id: string): Project | undefined {
    return projects().find((p) => p.id === id);
  }
  function nameForActive(id: ActiveId): string {
    return id === 'scratch' ? 'scratch' : (projectById(id)?.name ?? `Missing project (${id})`);
  }
  function doSwitch(id: ActiveId): void {
    setActiveId(id);
    setLauncherOpen(false);
    setMenuFor(null);
    setDialog(null);
    setToast({ kind: 'info', text: `Switched to ${nameForActive(id)}` });
  }
  // Switch active root from the launcher/chip. A DIRTY scratch would be discarded,
  // so prompt first (switch dialog carries pendingId); else switch immediately.
  function requestSwitch(id: ActiveId): void {
    const scratchDirty = activeId() === 'scratch' && scratch()?.dirty === true;
    if (scratchDirty && id !== 'scratch') {
      setDialog({ kind: 'switch', pendingId: id as string });
      setMenuFor(null);
      return;
    }
    doSwitch(id);
  }
  // Dirty binds to REAL owner file-writes (§57). App calls markDirty() from the
  // owner onFileWritten callback (editor + shell + file-tree), never a UI counter.
  // Named projects autosave; only the unnamed scratch goes dirty.
  function markDirty(): void {
    if (activeId() === 'scratch') {
      const s = scratch();
      if (s && !s.dirty) {
        setScratch({ ...s, dirty: true, editedAt: 'edited just now' });
      }
      return;
    }
    const proj = projectById(activeId());
    if (!proj) return;
    setProjects(projects().map((p) => (p.id === proj.id ? { ...p, editedAt: 'just now' } : p)));
    setToast({ kind: 'info', text: `Autosaved · ${proj.name}` });
  }

  // Tombstone of the last deleted project, so undoDelete can restore it (§9).
  let deleted: Project | null = null;

  function openDialog(d: Dialog): void {
    setDialog(d);
    setMenuFor(null);
  }
  // newId is allocated by the caller (saveScratchAsProject decides the on-disk
  // id; App threads it). Flip the mirror pointer LAST, mirroring the on-disk
  // copy->flip->delete order (§7).
  function confirmSave(name: string, newId: string): void {
    const s = scratch();
    if (!s) return;
    const proj: Project = { id: newId, name, starter: s.starter, editedAt: 'just now' };
    setProjects(projects().some((p) => p.id === newId) ? projects() : [...projects(), proj]);
    setScratch(null);
    setActiveId(newId);
    setDialog(null);
    setToast({ kind: 'info', text: `Saved as ${name}` });
  }
  function confirmRename(name: string): void {
    const d = dialog();
    const id = d && d.kind === 'rename' ? d.id : null;
    const trimmed = name.trim();
    if (!id || !trimmed) {
      setDialog(null);
      return;
    }
    setProjects(projects().map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
    setDialog(null);
    setToast({ kind: 'info', text: `Renamed to ${trimmed}` });
  }
  function confirmReset(): void {
    const d = dialog();
    const id = d && d.kind === 'reset' ? d.id : null;
    const s = scratch();
    if (id === 'scratch' && s) {
      setScratch({ ...s, dirty: false, editedAt: 'no edits yet' });
    } else if (id) {
      setProjects(projects().map((p) => (p.id === id ? { ...p, editedAt: 'just now' } : p)));
    }
    setDialog(null);
    setToast({ kind: 'info', text: 'Reset to starter' });
  }
  function confirmDelete(): void {
    const d = dialog();
    const id = d && d.kind === 'delete' ? d.id : null;
    if (!id) return;
    const victim = projectById(id);
    if (!victim) {
      setDialog(null);
      return;
    }
    const remaining = projects().filter((p) => p.id !== id);
    if (activeId() === id) {
      setActiveId(scratch() ? 'scratch' : (remaining[0]?.id ?? 'scratch'));
    }
    deleted = victim;
    setProjects(remaining);
    setDialog(null);
    setToast({ kind: 'info', text: `Deleted ${victim.name}`, undo: true });
  }
  function undoDelete(): void {
    if (!deleted) return;
    setProjects([...projects(), deleted]);
    setToast({ kind: 'info', text: `Restored ${deleted.name}` });
    deleted = null;
  }

  return {
    activeId,
    projects,
    scratch,
    dirty,
    storage,
    launcherOpen,
    launcherTab,
    menuFor,
    dialog,
    q,
    cat,
    toast,
    hydrateIndex(index) {
      const incoming = index.scratch;
      const localScratch = scratch();
      const keepPendingScratchStarter =
        pendingScratchStarter !== null &&
        activeId() === 'scratch' &&
        localScratch?.starter === pendingScratchStarter &&
        index.activeId === 'scratch' &&
        incoming !== null &&
        incoming.starter !== pendingScratchStarter;
      const keepLocalDirty =
        activeId() === 'scratch' &&
        localScratch?.dirty === true &&
        index.activeId === 'scratch' &&
        incoming !== null &&
        incoming.dirty === false &&
        incoming.starter === localScratch.starter;
      setActiveId(index.activeId);
      setProjects(index.projects);
      if (index.activeId !== 'scratch' || incoming?.starter === pendingScratchStarter) {
        pendingScratchStarter = null;
      }
      // ADR-0165 §4 boot-scratch: the OWNER does not model the active scratch in
      // its on-disk index until a Save (a cold-boot index is `scratch:null,
      // activeId:'scratch'`), yet `/scratch` genuinely exists on disk as the active
      // workspace. So when the published index lacks a scratch BUT is still
      // scratch-active, PRESERVE the local boot scratch (seeded from DEFAULT_PRESET)
      // — the chip/banner/Save reflect the real tree. A Save flips `activeId` to the
      // project id (so this preserve no longer applies) and the owner then publishes
      // `scratch:null` authoritatively. During an in-flight starter pick, ignore
      // stale scratch publications until the owner catches up to that starter.
      if (incoming === null && index.activeId === 'scratch' && scratch() !== null) return;
      if (keepPendingScratchStarter) return;
      if (keepLocalDirty) {
        setScratch({
          ...incoming,
          dirty: true,
          editedAt: localScratch?.editedAt ?? incoming.editedAt,
        });
        return;
      }
      setScratch(incoming);
    },
    pickStarter,
    requestSwitch,
    // Unguarded resolution of a confirmed switch dialog (skips the dirty re-prompt).
    confirmSwitchTo(id) {
      doSwitch(id);
    },
    confirmPickStarter(starterId) {
      createScratch(starterId);
    },
    markDirty,
    openDialog,
    confirmSave,
    confirmRename,
    confirmReset,
    confirmDelete,
    undoDelete,
    setActiveId(id) {
      setActiveId(id);
    },
    setStorage(k) {
      setStorage(k);
    },
    openLauncher() {
      setLauncherOpen(true);
    },
    closeLauncher() {
      setLauncherOpen(false);
    },
    setLauncherTab(t) {
      setLauncherTab(t);
    },
    setMenuFor(id) {
      setMenuFor(id);
    },
    setDialog(d) {
      setDialog(d);
    },
    setQ(v) {
      setQ(v);
    },
    setCat(c) {
      setCat(c);
    },
    setToast(t) {
      setToast(t);
    },
  };
}
