/**
 * Save/switch decision flow — headless core extracted from App.tsx (ADR-0197,
 * epic playground-testable-core, slice 4b). Owns Save-as-project phase tracking
 * (applied/durable), the plain-Save auto-switch to the saved root, the
 * Save-then-continue / Discard-then-continue switch-dialog resume (ADR-0165
 * §9), and the launcher switch/pick gates over in-flight saves and switches.
 *
 * No UI imports; every side effect goes through the injected ports below —
 * the behavioral-test seam (ADR-0197 §4). The workspace-lifecycle core
 * (slice 2) is injected as a port (dependency spine).
 */
import { createSignal } from 'solid-js';
import type { ActiveId, ProjectIndex } from '../glue/project-index.ts';

/** A switch the user chose in the dirty-scratch dialog (ADR-0165 §9). */
export interface PendingSwitchTarget {
  readonly pendingStarter?: string;
  readonly pendingId?: string;
}

/** ADR-0165 §7 durable Save phases (owner applies, then flushes). */
export interface SaveIndexPhases {
  readonly applied: Promise<ProjectIndex | null>;
  readonly durable: Promise<ProjectIndex | null>;
}

export interface SaveFlowDeps {
  store: {
    activeId(): ActiveId;
    dialog(): ({ readonly kind: string } & PendingSwitchTarget) | null;
    setDialog(dialog: null): void;
    /** Dirty-guarded switch request — a dirty scratch opens the switch dialog. */
    requestSwitch(id: ActiveId): void;
    /** Unguarded switch commit (the user already chose Save or Discard). */
    confirmSwitchTo(id: ActiveId): void;
    confirmSave(name: string, id: string): void;
  };
  /** Slice-2 workspace-lifecycle core injected as a port (ADR-0197 spine). */
  workspace: {
    waitForPendingSwitch(): Promise<boolean>;
    switchPending(): boolean;
    trackSwitch(switching: Promise<boolean>): Promise<boolean>;
    switchTo(id: ActiveId): Promise<boolean>;
    ensureStarted(ready: boolean): void;
  };
  /**
   * Unguarded starter pick with an EAGER TS gate (preset-boot core bound with
   * `commit: confirmPickStarter, guardDirtyScratch: false, eagerTsGate: true`):
   * re-invoking the guarded pick from a still-dirty scratch would re-open the
   * dialog and never flip activeId.
   */
  pickStarterUnguarded(starter: string): Promise<void>;
  /** Actual root the CURRENT owner is spawned at (`workspaceOwner().root`). */
  ownerRoot(): string;
  rootForId(id: ActiveId): string;
  /** Active starter read while the store is still scratch-active. */
  activeStarterId(): string;
  /** `saveAffordance(storageMode).ephemeral` — memory mode has no durable index. */
  ephemeral(): boolean;
  /** Post the durable on-disk move to the owner (port read at fire time). */
  saveIndexPhases(id: string, name: string, starter: string): SaveIndexPhases;
  openSaveDialog(): void;
  showSaveError(message: string): void;
  /** ADR-0165 §8 fidelity: a memory-mode save must never toast a durable `Saved`. */
  showEphemeralSaveNotice(name: string): void;
}

export interface SaveFlow {
  /** Confirm Save: durable post first, then the page-mirror flip (ADR-0165 §7). */
  confirmSave(name: string): Promise<void>;
  /** Switch active root from the launcher/chip (dirty scratch prompts). */
  launcherSwitch(id: ActiveId): Promise<void>;
  /**
   * Gate a starter pick over in-flight switch + save-apply; clears the plain-Save
   * auto-switch (the user picked something else). false = abort the pick.
   */
  beginStarterPick(): Promise<boolean>;
  /** Apply a confirmed switch target — UNGUARDED (the dialog already decided). */
  applyPendingTarget(target: PendingSwitchTarget): Promise<void>;
  /** Discard-then-continue: drop the switch dialog, apply the target now. */
  switchDiscardThen(): void;
  /** Save-then-continue: stash the target, open Save (the switch resumes there). */
  switchSaveThen(): void;
  /** A cancelled Save-then-continue drops its pending switch. */
  cancelPendingAfterSave(): void;
  /** The stashed Save-then-continue target (null = plain Save CTA). */
  pendingAfterSave(): PendingSwitchTarget | null;
}

/** Create inside a reactive root (App component / `createRoot` in tests). */
export function createSaveFlow(deps: SaveFlowDeps): SaveFlow {
  // The pending target is stashed across the Save dialog (which replaces the
  // switch dialog) so the switch resumes AFTER the save commits (ADR-0165 §9).
  const [pendingAfterSave, setPendingAfterSave] = createSignal<PendingSwitchTarget | null>(null);
  let pendingSaveApplied: Promise<boolean> | null = null;
  let pendingSaveDurability: Promise<boolean> | null = null;
  let pendingSaveAutoSwitchId: ActiveId | null = null;

  function trackSave(
    id: string,
    save: SaveIndexPhases,
  ): { applied: Promise<boolean>; durable: Promise<boolean> } {
    const appliedWait = (async (): Promise<boolean> => {
      const index = await save.applied;
      return index?.projects.some((p) => p.id === id) === true;
    })();
    const applied = appliedWait.finally(() => {
      if (pendingSaveApplied === applied) pendingSaveApplied = null;
    });
    pendingSaveApplied = applied;

    const durableWait = (async (): Promise<boolean> => {
      const index = await save.durable;
      return index?.projects.some((p) => p.id === id) === true;
    })();
    const durable = durableWait.finally(() => {
      if (pendingSaveDurability === durable) pendingSaveDurability = null;
    });
    pendingSaveDurability = durable;
    return { applied, durable };
  }

  async function waitForPendingSaveApplied(): Promise<boolean> {
    return (await pendingSaveApplied?.catch(() => false)) ?? true;
  }

  async function waitForPendingSaveDurable(): Promise<boolean> {
    return (await pendingSaveDurability?.catch(() => false)) ?? true;
  }

  // Respawn the owner at the saved project root after a plain Save-as-project —
  // only while the save is still the user's LAST intent (any later pick/switch
  // clears the auto-switch id) and the owner is not already there.
  async function switchToSavedProjectAfterSave(
    id: ActiveId,
    saved: Promise<boolean>,
  ): Promise<void> {
    try {
      if (deps.ephemeral()) return;
      if (!(await saved)) return;
      if (pendingAfterSave()) return;
      if (pendingSaveAutoSwitchId !== id) return;
      if (deps.workspace.switchPending()) return;
      if (deps.store.activeId() !== id) return;
      if (deps.ownerRoot() === deps.rootForId(id)) return;
      void deps.workspace.trackSwitch(deps.workspace.switchTo(id));
    } finally {
      if (pendingSaveAutoSwitchId === id) pendingSaveAutoSwitchId = null;
    }
  }

  // Confirm Save: the store flips the mirror pointer; a fresh page id is allocated
  // (the owner reconciles the on-disk move via saveScratchAsProject + its index).
  // ADR-0165 §8 fidelity: a memory-mode save is EPHEMERAL — its toast must NEVER
  // read like a durable `Saved as <name>`.
  async function confirmSave(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Collision-free project id (crypto.randomUUID, Math.random fallback) — a
    // collision would make saveScratchAsProject throw `already exists` owner-side
    // while the page optimistically flipped activeId onto another project's tree.
    const id = `p-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
    const ephemeral = deps.ephemeral();
    // ADR-0165 §7 durable Save: post the on-disk move FIRST (owner copies /scratch
    // → /projects/<id>, flips+persists the index, deletes /scratch), reading the
    // active STARTER while the store is still scratch-active (confirmSave below
    // flips activeId to the project). The owner re-publishes only after flush;
    // waiting here prevents a late save publish from reverting a following
    // starter-pick/switch. Skipped in memory mode (EPHEMERAL — no durable tree).
    const durableSave: SaveIndexPhases = ephemeral
      ? {
          applied: Promise.resolve<ProjectIndex | null>(null),
          durable: Promise.resolve<ProjectIndex | null>(null),
        }
      : (() => {
          const phases = deps.saveIndexPhases(id, trimmed, deps.activeStarterId());
          return {
            applied: phases.applied.catch((err: unknown) => {
              console.error('[project-index] save apply failed', err);
              const message = err instanceof Error ? err.message : String(err);
              deps.showSaveError(`Save failed: ${message}`);
              return null;
            }),
            durable: phases.durable.catch((err: unknown) => {
              console.warn('[project-index] save durability still pending', err);
              return null;
            }),
          };
        })();
    const saveWait = ephemeral
      ? { applied: Promise.resolve(true), durable: Promise.resolve(true) }
      : trackSave(id, durableSave);
    deps.store.confirmSave(trimmed, id);
    if (ephemeral) deps.showEphemeralSaveNotice(trimmed);
    // Save-then-continue resume (ADR-0165 §9): the switch dialog stashed a target.
    // Wait for the save to be DURABLE before switchTo hard-kills the owner (else
    // the committed tree races the teardown and the respawn boots empty), then apply.
    const pending = pendingAfterSave();
    if (pending) {
      setPendingAfterSave(null);
      if (await saveWait.durable) await applyPendingTarget(pending);
    } else if (!ephemeral) {
      pendingSaveAutoSwitchId = id;
      void switchToSavedProjectAfterSave(id, saveWait.durable);
    }
  }

  // Switch active root from the launcher/chip. The store gates a dirty scratch
  // (switch dialog); an applied switch drives the real owner respawn (switchTo).
  async function launcherSwitch(id: ActiveId): Promise<void> {
    pendingSaveAutoSwitchId = null;
    if (!(await deps.workspace.waitForPendingSwitch())) return;
    if (!(await waitForPendingSaveDurable())) return;
    const ownerNeedsSwitch = deps.ownerRoot() !== deps.rootForId(id);
    deps.store.requestSwitch(id);
    const prompted = deps.store.dialog()?.kind === 'switch';
    if (!prompted && ownerNeedsSwitch) {
      void deps.workspace.trackSwitch(deps.workspace.switchTo(id));
    } else if (!prompted) {
      void deps.workspace.ensureStarted(true);
    }
  }

  async function beginStarterPick(): Promise<boolean> {
    pendingSaveAutoSwitchId = null;
    if (!(await deps.workspace.waitForPendingSwitch())) return false;
    if (!(await waitForPendingSaveApplied())) return false;
    return true;
  }

  // Apply a confirmed switch target — UNGUARDED (the user already chose Save or
  // Discard, ADR-0165 §9). Uses the store's `confirm*` transitions, NOT the
  // dirty-guarded `requestSwitch`/`pickStarter`: re-invoking the guarded ones from
  // a still-dirty scratch would re-open the switch dialog and never flip activeId,
  // so the owner would respawn at the new root with the OLD template/starter.
  async function applyPendingTarget(target: PendingSwitchTarget): Promise<void> {
    if (target.pendingStarter) {
      await deps.pickStarterUnguarded(target.pendingStarter);
    } else if (target.pendingId) {
      deps.store.confirmSwitchTo(target.pendingId);
      void deps.workspace.trackSwitch(deps.workspace.switchTo(target.pendingId));
    }
  }

  // Discard-then-continue: drop the switch dialog and apply the pending target
  // immediately (the unnamed draft is kept on disk; only the save-as-project is
  // skipped — ADR-0165 §9).
  function switchDiscardThen(): void {
    const d = deps.store.dialog();
    deps.store.setDialog(null);
    if (d?.kind === 'switch') void applyPendingTarget(d);
  }

  // Save-then-continue: stash the pending target, then open the Save dialog (which
  // replaces the switch dialog). The switch RESUMES in confirmSave AFTER the save
  // commits — so "Save scratch, then continue" actually continues (ADR-0165 §9).
  function switchSaveThen(): void {
    const d = deps.store.dialog();
    if (d?.kind === 'switch')
      setPendingAfterSave({ pendingStarter: d.pendingStarter, pendingId: d.pendingId });
    deps.openSaveDialog();
  }

  return {
    confirmSave,
    launcherSwitch,
    beginStarterPick,
    applyPendingTarget,
    switchDiscardThen,
    switchSaveThen,
    cancelPendingAfterSave: () => setPendingAfterSave(null),
    pendingAfterSave,
  };
}
