/**
 * Save/switch decision flow — headless core extracted from App.tsx (ADR-0197,
 * epic playground-testable-core, slice 4b). Owns Save-as-project phase tracking,
 * the plain-Save owner respawn, and confirmed dirty-scratch continuations.
 *
 * Every owner-bound operation enters the injected project-owner coordinator.
 * Internal continuations switch directly while retaining that lease: re-enqueueing
 * would deadlock the FIFO and split ownership of the same invariant.
 */
import { createSignal } from 'solid-js';
import type { Dialog, SaveDialog } from '../glue/page-store.ts';
import type { ActiveId, ProjectIndex } from '../glue/project-index.ts';
import type { ProjectOwnerCoordinator, ProjectOwnerLease } from './project-owner-coordinator.ts';

/** A switch the user chose in the dirty-scratch dialog (ADR-0165 §9). */
export interface PendingSwitchTarget {
  readonly pendingStarter?: string;
  readonly pendingId?: string;
}

/** ADR-0165 §7 durable Save phases (owner applies, then flushes). */
export type SaveApplication =
  | { readonly kind: 'applied'; readonly index: ProjectIndex }
  | { readonly kind: 'not-applied'; readonly error: Error }
  | { readonly kind: 'unknown'; readonly error: Error };

export interface SaveIndexPhases {
  readonly application: Promise<SaveApplication>;
  readonly durable: Promise<ProjectIndex | null>;
}

export interface SaveFlowDeps {
  store: {
    activeId(): ActiveId;
    dialog(): Dialog;
    setDialog(dialog: null): void;
    /** Dirty-guarded switch request — a dirty scratch opens the switch dialog. */
    requestSwitch(id: ActiveId): void;
    /** Unguarded switch commit (the user already chose Save or Discard). */
    confirmSwitchTo(id: ActiveId): void;
    confirmSave(name: string, id: string, intent: SaveDialog): void;
  };
  /** The single FIFO authority for owner mutations and replacements. */
  projectOwner: ProjectOwnerCoordinator;
  /** Slice-2 workspace-lifecycle core injected as a port (ADR-0197 spine). */
  workspace: {
    trackSwitch(switching: Promise<boolean>): Promise<boolean>;
    switchTo(id: ActiveId): Promise<boolean>;
    ensureStarted(ready: boolean): Promise<unknown>;
  };
  /**
   * Unguarded starter pick with an EAGER TS gate (preset-boot core bound with
   * `commit: confirmPickStarter, guardDirtyScratch: false, eagerTsGate: true`).
   */
  pickStarterUnguarded(starter: string): Promise<void>;
  /** Actual root the CURRENT owner is spawned at (`workspaceOwner().root`). */
  ownerRoot(): string;
  rootForId(id: ActiveId): string;
  /** Active starter read while the store is still scratch-active. */
  activeStarterId(): string;
  /** Collision-free project id for a Save (App binds crypto.randomUUID). */
  createProjectId(): string;
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
  /** Confirm Save: owner apply + durability stay inside one owner lease. */
  confirmSave(name: string): Promise<void>;
  /** Switch active root from the launcher/chip (dirty scratch prompts). */
  launcherSwitch(id: ActiveId): Promise<void>;
  /** Discard-then-continue: drop the switch dialog, enqueue its target. */
  switchDiscardThen(): void;
  /** Save-then-continue: stash the target, open Save (the switch resumes there). */
  switchSaveThen(): void;
  /** A cancelled Save-then-continue drops its pending switch. */
  cancelPendingAfterSave(): void;
  /** The stashed Save-then-continue target (null = plain Save CTA). */
  pendingAfterSave(): PendingSwitchTarget | null;
}

interface DurableProof {
  readonly proved: boolean;
  readonly error: Error | null;
}

function asError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(`${fallback}: ${String(error)}`);
}

/** Create inside a reactive root (App component / `createRoot` in tests). */
export function createSaveFlow(deps: SaveFlowDeps): SaveFlow {
  // The target survives the Save dialog which replaces the switch dialog.
  const [pendingAfterSave, setPendingAfterSave] = createSignal<PendingSwitchTarget | null>(null);

  async function runOwner(
    label: string,
    intentCurrent: () => boolean,
    operation: (lease: ProjectOwnerLease) => Promise<void>,
  ): Promise<void> {
    try {
      await deps.projectOwner.run(intentCurrent, operation);
    } catch (error: unknown) {
      // A fenced coordinator must not become an unhandled rejection at `void`
      // event-handler call sites; the originating Save already surfaced details.
      console.error(`[project-index] ${label} failed`, error);
    }
  }

  function observeApplication(id: string, save: SaveIndexPhases): Promise<SaveApplication> {
    return save.application.then(
      (outcome): SaveApplication => {
        if (outcome.kind === 'applied' && outcome.index.projects.some((p) => p.id === id)) {
          return outcome;
        }
        const resolved =
          outcome.kind === 'applied'
            ? {
                kind: 'unknown' as const,
                error: new Error(`project index Save applied proof omitted ${id}`),
              }
            : outcome;
        console.error('[project-index] save apply failed', resolved.error);
        deps.showSaveError(`Save failed: ${resolved.error.message}`);
        return resolved;
      },
      (error: unknown): SaveApplication => {
        const resolved = asError(error, 'project index Save application outcome is unknown');
        console.error('[project-index] save apply failed', resolved);
        deps.showSaveError(`Save failed: ${resolved.message}`);
        return { kind: 'unknown', error: resolved };
      },
    );
  }

  function observeDurability(id: string, save: SaveIndexPhases): Promise<DurableProof> {
    return save.durable.then(
      (index): DurableProof => {
        if (index?.projects.some((p) => p.id === id) === true) {
          return { proved: true, error: null };
        }
        const error = new Error(`project index Save durability proof omitted ${id}`);
        console.warn('[project-index] save durability still pending', error);
        return { proved: false, error };
      },
      (error: unknown): DurableProof => {
        const resolved = asError(error, 'project index Save durability is unknown');
        console.warn('[project-index] save durability still pending', resolved);
        return { proved: false, error: resolved };
      },
    );
  }

  async function applyPendingTargetWithinLease(target: PendingSwitchTarget): Promise<void> {
    if (target.pendingStarter) {
      await deps.pickStarterUnguarded(target.pendingStarter);
    } else if (target.pendingId) {
      deps.store.confirmSwitchTo(target.pendingId);
      await deps.workspace.trackSwitch(deps.workspace.switchTo(target.pendingId));
    }
  }

  async function confirmSave(name: string): Promise<void> {
    const trimmed = name.trim();
    const intent = deps.store.dialog();
    if (!trimmed || intent?.kind !== 'save') return;

    await runOwner(
      'save',
      () => deps.store.dialog() === intent,
      async (lease) => {
        const id = deps.createProjectId();
        const ephemeral = deps.ephemeral();

        if (ephemeral) {
          deps.store.confirmSave(trimmed, id, intent);
          deps.showEphemeralSaveNotice(trimmed);
        } else {
          // Attach both observers synchronously: an early durability rejection is
          // handled even while the application proof is still pending.
          const phases = deps.saveIndexPhases(id, trimmed, deps.activeStarterId());
          const application = observeApplication(id, phases);
          const durability = observeDurability(id, phases);
          const applied = await application;

          if (applied.kind === 'not-applied') return;
          if (applied.kind === 'unknown') lease.fence(applied.error);

          // The page follows the proved owner application, even if the exact Save
          // dialog was replaced while the owner operation was already admitted.
          deps.store.confirmSave(trimmed, id, intent);
          const durable = await durability;
          if (!durable.proved) {
            lease.fence(durable.error ?? new Error('project index Save durability is unknown'));
          }
        }

        const pending = pendingAfterSave();
        if (pending) {
          setPendingAfterSave(null);
          await applyPendingTargetWithinLease(pending);
          return;
        }

        // The page already points at this project, so root reconciliation is part
        // of the admitted Save. A later FIFO ticket may transition again.
        if (ephemeral || deps.store.activeId() !== id || deps.ownerRoot() === deps.rootForId(id)) {
          return;
        }
        await deps.workspace.trackSwitch(deps.workspace.switchTo(id));
      },
    );
  }

  async function launcherSwitch(id: ActiveId): Promise<void> {
    await runOwner(
      'launcher switch',
      () => true,
      async () => {
        const ownerNeedsSwitch = deps.ownerRoot() !== deps.rootForId(id);
        deps.store.requestSwitch(id);
        const prompted = deps.store.dialog()?.kind === 'switch';
        if (!prompted && ownerNeedsSwitch) {
          await deps.workspace.trackSwitch(deps.workspace.switchTo(id));
        } else if (!prompted) {
          await deps.workspace.ensureStarted(true);
        }
      },
    );
  }

  function switchDiscardThen(): void {
    const intent = deps.store.dialog();
    deps.store.setDialog(null);
    if (intent?.kind !== 'switch') return;
    void runOwner(
      'discard switch',
      () => true,
      async () => {
        await applyPendingTargetWithinLease(intent);
      },
    );
  }

  function switchSaveThen(): void {
    const intent = deps.store.dialog();
    if (intent?.kind === 'switch') {
      setPendingAfterSave({
        pendingStarter: intent.pendingStarter,
        pendingId: intent.pendingId,
      });
    }
    deps.openSaveDialog();
  }

  return {
    confirmSave,
    launcherSwitch,
    switchDiscardThen,
    switchSaveThen,
    cancelPendingAfterSave: () => setPendingAfterSave(null),
    pendingAfterSave,
  };
}
