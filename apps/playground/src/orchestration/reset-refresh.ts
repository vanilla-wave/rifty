/**
 * Reset/rename confirm flow — headless core extracted from App.tsx (ADR-0197,
 * epic playground-testable-core, slice 4b). Owns the ADR-0165 §6 REAL on-disk
 * re-seed (scratch and named projects), the active-root live refresh (fresh
 * snapshot frame → editor tabs → dev-server reboot), and the durable rename
 * post.
 *
 * No UI imports; every side effect goes through the injected ports below —
 * the behavioral-test seam (ADR-0197 §4). The dev-server core (slice 1) is
 * injected as a port (dependency spine).
 */
import type { ActiveId } from '../glue/project-index.ts';

/** An owner republish can be lost mid-switch; never hang the refresh on it. */
const SNAPSHOT_FRAME_TIMEOUT_MS = 2000;

export interface ResetRefreshDeps {
  store: {
    activeId(): ActiveId;
    dialog(): { readonly kind: string; readonly id?: string } | null;
    confirmReset(): void;
    confirmRename(name: string): void;
  };
  /** Slice-1 dev-server core injected as a port (ADR-0197 spine). */
  devServer: {
    sessionId(): string | null;
    lifecycleRunning(): boolean;
    restart(sessionId: string): void;
  };
  /** No live owner channel yet (hidden boot not finished) — skip the frame wait. */
  ownerUnavailable(): boolean;
  /** Subscribe to applied page-side snapshot frames; returns an unsubscribe. */
  subscribeSnapshot(cb: () => void): () => void;
  /** Ask the CURRENT owner to republish its snapshot (port read at fire time). */
  requestSnapshot(): void;
  /** Reopen the active preset's initial editor tabs (paint refresh). */
  resetEditorInitialFiles(): void;
  flushEditorWrites(): Promise<void>;
  /** `saveAffordance(storageMode).ephemeral` — memory mode posts nothing durable. */
  ephemeral(): boolean;
  activeStarterId(): string;
  /** Owner index posts, bound with the live snapshot port at fire time. */
  resetScratchIndex(starter: string): Promise<unknown>;
  resetProjectIndex(id: string): Promise<unknown>;
  renameProjectIndex(id: string, name: string): Promise<unknown>;
}

export interface ResetRefresh {
  /** Resolve on the next applied snapshot frame (bounded — see module const). */
  waitForActiveSnapshotFrame(): Promise<void>;
  /** Fresh frame → reopen initial tabs → reboot a running dev server (§6). */
  refreshActiveAfterReset(): Promise<void>;
  /** Confirm Reset: flush edits → durable re-seed → mirror flip → live refresh. */
  confirmReset(): void;
  /** Confirm Rename: durable rename post (pre-flip id) → mirror flip. */
  confirmRename(name: string): void;
}

/** Create inside a reactive root (App component / `createRoot` in tests). */
export function createResetRefresh(deps: ResetRefreshDeps): ResetRefresh {
  // Re-seed visible editor tabs + restart the dev server after the OWNER
  // re-seeded the ACTIVE root (ADR-0165 §6). The owner already republished the
  // file snapshot (reset-refresh hook), so the explorer is fresh; here the page
  // reopens the preset's initial files and reboots the dev server so the preview
  // reflects the restored tree (node_modules was wiped → the boot re-installs).
  async function waitForActiveSnapshotFrame(): Promise<void> {
    if (deps.ownerUnavailable()) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      let unsubscribe: () => void = () => {};
      const finish = (): void => {
        if (settled) return;
        settled = true;
        unsubscribe();
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, SNAPSHOT_FRAME_TIMEOUT_MS);
      unsubscribe = deps.subscribeSnapshot(finish);
      deps.requestSnapshot();
    });
  }

  async function refreshActiveAfterReset(): Promise<void> {
    await waitForActiveSnapshotFrame();
    deps.resetEditorInitialFiles();
    const activeDevServerSessionId = deps.devServer.sessionId();
    if (deps.devServer.lifecycleRunning() && activeDevServerSessionId) {
      void deps.devServer.restart(activeDevServerSessionId);
    }
  }

  // Confirm Reset (ADR-0165 §6): a REAL on-disk re-seed for both the active scratch
  // (index-reset) and a named project (index-reset-project) — the owner wipes +
  // re-derives the tree from the starter bundle and re-publishes. When the reset
  // target is the ACTIVE root, also refresh the live editor + dev server so the
  // "restores the clean starter files" promise is true on screen, not just on disk.
  // Memory mode skips the durable post (page-mirror only).
  function confirmReset(): void {
    const d = deps.store.dialog();
    const id = d && d.kind === 'reset' ? (d.id ?? null) : null;
    const activeReset = id === deps.store.activeId();
    void (async (): Promise<void> => {
      await deps.flushEditorWrites();
      if (id && !deps.ephemeral()) {
        if (id === 'scratch') {
          await deps.resetScratchIndex(deps.activeStarterId());
        } else {
          await deps.resetProjectIndex(id);
        }
      }
      deps.store.confirmReset();
      if (activeReset) await refreshActiveAfterReset();
    })().catch((err: unknown) => console.error('[project-index] reset failed', err));
  }

  // Confirm Rename: post the durable on-disk rename to the owner (it rewrites the
  // index `name` + re-publishes) reading the dialog's target id BEFORE the store
  // flips it, then flip the page mirror (immediate UX; the owner reconciles).
  function confirmRename(name: string): void {
    const d = deps.store.dialog();
    const id = d && d.kind === 'rename' ? (d.id ?? null) : null;
    const trimmed = name.trim();
    if (id && trimmed && !deps.ephemeral()) {
      void deps
        .renameProjectIndex(id, trimmed)
        .catch((err: unknown) => console.error('[project-index] rename failed', err));
    }
    deps.store.confirmRename(name);
  }

  return { waitForActiveSnapshotFrame, refreshActiveAfterReset, confirmReset, confirmRename };
}
