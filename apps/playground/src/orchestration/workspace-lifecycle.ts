/**
 * Workspace-owner lifecycle orchestration — headless core extracted from
 * App.tsx (ADR-0197, epic playground-testable-core, slice 2). Owns the owner
 * START gate (cold boot spawns a hidden /scratch owner; the first real project
 * choice respawns/adopts it), the sequential project SWITCH (teardown → respawn
 * via `requestSwitch`, ADR-0165 §3), switch tracking/recovery, and the
 * reload-RESTORE decision (re-root vs adopt, then relaunch the dev server).
 *
 * No UI imports (dep-cruiser rule `no-ui-imports-in-playground-orchestration`);
 * every side effect goes through the injected ports below — the behavioral-test
 * seam (ADR-0197 §4).
 */
import { createSignal } from 'solid-js';
import { type ActiveId, type ProjectIndex, rootForId } from '../glue/project-index.ts';
import { requestSwitch } from '../glue/switch-owner.ts';

/** Owner surface the lifecycle needs (structural subset of WorkspaceOwnerHandle). */
export interface WorkspaceOwnerLike {
  readonly root: string;
  readonly ready: Promise<unknown>;
  readonly closed: Promise<unknown>;
  close(): void;
  isAlive(): boolean;
}

export interface WorkspaceLifecycleDeps<O extends WorkspaceOwnerLike> {
  /** The live owner handle (App's owner signal accessor). */
  currentOwner(): O;
  /** Swap the owner signal — the swap re-runs every page bridge effect (ADR-0165 §3). */
  setOwner(next: O): void;
  /** Spawn an owner at the ACTIVE root/template (first real start after the hidden boot). */
  createActiveOwner(): O;
  /** Spawn the switch target's owner (template follows the store, already re-pointed). */
  spawnOwner(opts: { root: string; slug: string }): O;
  /** Re-bind the terminal manager's pty channel to the new owner. */
  rebindTerminal(owner: O): Promise<void>;
  /** Resolves on the NEW owner's first published snapshot frame (bounded fallback). */
  awaitOwnerReady(owner: O): Promise<void>;
  /** Await a fresh ACTIVE-root snapshot frame after the switch re-wire. */
  awaitActiveSnapshotFrame(): Promise<void>;
  /**
   * Drain debounced editor writes to the CURRENT (still-alive) owner BEFORE
   * teardown: a flush firing mid-respawn would hit the not-started guard, drop
   * the bytes, yet clear the tab dirty marker (silent data loss).
   */
  flushEditorWrites(): Promise<void>;
  /** Memory mode has no durable index → the switch skips the durable activeId persist. */
  readonly ephemeralStorage: boolean;
  /**
   * PERSIST the new active root to the durable index BEFORE teardown (ADR-0165
   * §3): else the respawned owner re-publishes the STALE activeId (mirror
   * reverts the switch) and a reload boots the wrong root.
   */
  persistActiveId(id: ActiveId): Promise<void>;
  /** Preset-transition veil around the switch (the preset-boot slice binds the queue). */
  transition: { begin(): void; end(): void };
  /** Earlier-slice module injected as a port (ADR-0197 dependency spine). */
  devServer: {
    lifecycleRunning(): boolean;
    sessionId(): string | null;
    markStopped(): void;
    restart(sessionId: string): Promise<void>;
  };
  clearTerminal(sessionId: string): void;
  resetEditorInitialFiles(): void;
  confirmDiscard(): Promise<boolean>;
  showSwitchError(message: string): void;
  /**
   * Relaunch the co-resident dev server after a reload restore (ADR-0148): the
   * pty command died with the previous page, so the owner re-boot restores the
   * TREE but not the running server. Fire-and-forget; the preset-boot slice
   * serializes it through the preset-transition queue.
   */
  relaunchDevServer(): void;
}

export interface WorkspaceLifecycle<O extends WorkspaceOwnerLike> {
  /** True once a REAL (non-hidden-boot-pending) owner is adopted — editor-write gate. */
  started(): boolean;
  /** Reactive readiness for the workspace UI (`data-workspace-owner` attr). */
  ownerReady(): boolean;
  setOwnerReady(ready: boolean): void;
  /**
   * Adopt/(re)spawn the owner once: started → await ready; else close the
   * hidden-boot owner, await its exit, spawn the ACTIVE owner, rebind the
   * terminal. Concurrent calls coalesce on the in-flight start.
   */
  ensureStarted(markReady?: boolean): Promise<O>;
  /** Sequential switch: teardown → respawn at `rootForId(nextActiveId)` (ADR-0165 §3). */
  switchTo(nextActiveId: ActiveId): Promise<boolean>;
  /**
   * Track a switch: failures surface a toast and recover `started` from the
   * live owner (a throw before restartDevServer would otherwise wedge every
   * later editor write behind the "choose a project" guard).
   */
  trackSwitch(run: Promise<boolean>): Promise<boolean>;
  waitForPendingSwitch(): Promise<boolean>;
  switchPending(): boolean;
  /**
   * Re-root + RELAUNCH the restored project on reload: root mismatch (saved
   * project) → owner respawn via switchTo; same root (dirty scratch draft) →
   * the already-started hidden owner adopts it. THEN relaunch the dev server.
   */
  restoreOnReload(idx: ProjectIndex): Promise<void>;
}

/** Create inside a reactive root (App component / `createRoot` in tests). */
export function createWorkspaceLifecycle<O extends WorkspaceOwnerLike>(
  deps: WorkspaceLifecycleDeps<O> & { initiallyStarted: boolean },
): WorkspaceLifecycle<O> {
  let started = deps.initiallyStarted;
  let startInFlight: Promise<O> | null = null;
  let pendingSwitch: Promise<boolean> | null = null;
  const [ownerReady, setOwnerReady] = createSignal(false);

  async function ensureStarted(markReady = true): Promise<O> {
    if (started) {
      const current = deps.currentOwner();
      await current.ready;
      if (markReady) setOwnerReady(true);
      return current;
    }
    if (startInFlight) return startInFlight;
    const current = deps.currentOwner();
    startInFlight = (async (): Promise<O> => {
      setOwnerReady(false);
      current.close();
      await current.closed;
      const next = deps.createActiveOwner();
      deps.setOwner(next);
      await deps.rebindTerminal(next);
      started = true;
      if (markReady) setOwnerReady(true);
      return next;
    })().finally(() => {
      startInFlight = null;
    });
    return startInFlight;
  }

  async function switchTo(nextActiveId: ActiveId): Promise<boolean> {
    try {
      deps.transition.begin();
      // Flush BEFORE the not-started flip so the write lands on the still-alive
      // owner rather than being dropped while the tab is marked clean.
      await deps.flushEditorWrites();
      started = false;
      setOwnerReady(false);
      if (!deps.ephemeralStorage) await deps.persistActiveId(nextActiveId);
      const restartSessionId = deps.devServer.lifecycleRunning()
        ? deps.devServer.sessionId()
        : null;
      const switched = await requestSwitch({
        currentOwner: deps.currentOwner(),
        nextRoot: rootForId(nextActiveId),
        nextSlug: nextActiveId,
        // The dirty-scratch confirm already ran in the store (the switch dialog),
        // so the switch is committed by the time we get here.
        isDirty: () => false,
        confirmDiscard: () => deps.confirmDiscard(),
        save: async () => {
          /* unused: durable Save persists via onConfirmSave → owner index-save */
        },
        discard: async () => {
          /* unused: durable reset persists via onConfirmReset → owner index-reset */
        },
        spawn: ({ root, slug }) => deps.spawnOwner({ root, slug }),
        awaitReady: (next) => deps.awaitOwnerReady(next),
        rewireBridges: (next) => deps.setOwner(next), // signal swap re-runs every bridge effect
        restartDevServer: async () => {
          deps.devServer.markStopped();
          await deps.rebindTerminal(deps.currentOwner());
          started = true;
          setOwnerReady(true);
          if (restartSessionId) await deps.devServer.restart(restartSessionId);
        },
        clearTerminal: () => {
          if (restartSessionId) deps.clearTerminal(restartSessionId);
        },
      });
      if (switched) {
        await deps.awaitActiveSnapshotFrame();
        deps.resetEditorInitialFiles();
      }
      return switched;
    } finally {
      deps.transition.end();
    }
  }

  function trackSwitch(run: Promise<boolean>): Promise<boolean> {
    const tracked = run
      .catch((err: unknown) => {
        console.error('[project-switch] switch failed', err);
        const message = err instanceof Error ? err.message : String(err);
        deps.showSwitchError(`Switch failed: ${message}`);
        if (!started && deps.currentOwner().isAlive()) {
          started = true;
          setOwnerReady(true);
        }
        return false;
      })
      .finally(() => {
        if (pendingSwitch === tracked) pendingSwitch = null;
      });
    pendingSwitch = tracked;
    return tracked;
  }

  async function waitForPendingSwitch(): Promise<boolean> {
    return (await pendingSwitch) ?? true;
  }

  async function restoreOnReload(idx: ProjectIndex): Promise<void> {
    if (deps.currentOwner().root !== rootForId(idx.activeId)) {
      if (!(await trackSwitch(switchTo(idx.activeId)))) return;
    } else {
      await ensureStarted(true);
    }
    deps.relaunchDevServer();
  }

  return {
    started: () => started,
    ownerReady,
    setOwnerReady,
    ensureStarted,
    switchTo,
    trackSwitch,
    waitForPendingSwitch,
    switchPending: () => pendingSwitch !== null,
    restoreOnReload,
  };
}
