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
import type { Dialog, RenameDialog, ResetDialog } from '../glue/page-store.ts';
import type { ActiveId } from '../glue/project-index.ts';
import type { ProjectOwnerCoordinator } from './project-owner-coordinator.ts';

/** An owner republish can be lost mid-switch; never hang the refresh on it. */
const SNAPSHOT_FRAME_TIMEOUT_MS = 2000;

export interface ResetRefreshDeps {
  store: {
    activeId(): ActiveId;
    dialog(): Dialog;
    confirmReset(id: ActiveId, intent: ResetDialog): void;
    confirmRename(id: string, name: string, intent: RenameDialog): void;
  };
  /** Sole FIFO authority for owner-bound mutations and replacements. */
  projectOwner: ProjectOwnerCoordinator;
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
  /** Confirm Reset: FIFO admission → flush → durable re-seed → explicit mirror commit. */
  confirmReset(): void;
  /** Confirm Rename: FIFO admission → proved durable post → explicit mirror commit. */
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
    const intent = deps.store.dialog();
    if (!intent || intent.kind !== 'reset') return;
    void deps.projectOwner
      .run(
        () => deps.store.dialog() === intent,
        async () => {
          await deps.flushEditorWrites();
          // The dialog can be canceled/replaced while editor writes drain. Do
          // not bind its owner post after that asynchronous boundary.
          if (deps.store.dialog() !== intent) return;
          const activeReset = intent.id === deps.store.activeId();
          if (!deps.ephemeral()) {
            if (intent.id === 'scratch') {
              await deps.resetScratchIndex(deps.activeStarterId());
            } else {
              await deps.resetProjectIndex(intent.id);
            }
          }
          deps.store.confirmReset(intent.id, intent);
          if (activeReset) await refreshActiveAfterReset();
        },
      )
      .catch((err: unknown) => console.error('[project-index] reset failed', err));
  }

  // The coordinator validates the exact dialog object at FIFO head. Once the
  // owner post is admitted it runs to a terminal result; the explicit commit
  // updates that captured project without dismissing a newer dialog.
  function confirmRename(name: string): void {
    const intent = deps.store.dialog();
    if (!intent || intent.kind !== 'rename') return;
    const trimmed = name.trim();
    if (!trimmed) {
      deps.store.confirmRename(intent.id, name, intent);
      return;
    }
    void deps.projectOwner
      .run(
        () => deps.store.dialog() === intent,
        async () => {
          if (!deps.ephemeral()) await deps.renameProjectIndex(intent.id, trimmed);
          deps.store.confirmRename(intent.id, name, intent);
        },
      )
      .catch((err: unknown) => console.error('[project-index] rename failed', err));
  }

  return { waitForActiveSnapshotFrame, refreshActiveAfterReset, confirmReset, confirmRename };
}
