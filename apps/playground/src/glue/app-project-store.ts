import { type Dialog, type PageStore, type StorageKind, createPageStore } from './page-store.ts';
/**
 * App-level project-store wrapper (ADR-0165 §57/§56). Wraps the page store
 * (`createPageStore`, glue/page-store.ts) with the two bindings that need live
 * App context and therefore can't live in the pure store:
 *  - DIRTY binds to the REAL owner file-write signal (§57) — never a UI counter.
 *    `markDirty()` runs from the owner's `onFileWritten` callback (editor + shell
 *    + file-tree writes), so the scratch goes dirty only on an actual write.
 *  - DELETE-with-Undo defers the on-disk tree removal to the toast window (§56):
 *    `confirmDelete()` flips the page mirror immediately (so the launcher updates)
 *    but schedules the irreversible on-disk delete after a grace window; `undoDelete()`
 *    cancels that timer, so an Undo NEVER deletes the tree.
 *
 * Lives in glue (not App.tsx) so it is unit-testable in the node vitest env:
 * App.tsx transitively imports browser-only modules (xterm), so importing it in a
 * node test throws `self is not defined`. App.tsx re-exports this factory.
 */
import type { ProjectIndex } from './project-index.ts';

/** Grace window before the deferred on-disk delete fires (§56). */
export const DELETE_GRACE_MS = 3200;

/** Minimal owner surface the store consumes: a file-write subscription (§57). */
export interface AppStoreOwner {
  onFileWritten(cb: (path: string, content: string) => void): () => void;
}

export interface AppProjectStoreDeps {
  readonly index: ProjectIndex;
  readonly storage: StorageKind;
  readonly owner: AppStoreOwner;
  /** Irreversible on-disk tree removal, deferred to the toast window (§56). */
  readonly onDiskDelete?: (projectId: string) => void;
}

/**
 * The App project store: the page store plus the live owner bindings. The
 * returned object spreads the whole {@link PageStore} surface, overriding only
 * `confirmDelete`/`undoDelete` to thread the deferred on-disk delete.
 */
export function createAppProjectStore(deps: AppProjectStoreDeps): PageStore {
  const store = createPageStore();
  store.hydrateIndex(deps.index);
  store.setStorage(deps.storage);

  // Dirty binds to the REAL owner write signal (§57), never a UI counter.
  deps.owner.onFileWritten(() => store.markDirty());

  // Delete-with-Undo defers the on-disk removal to the toast window (§56).
  let pending: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  function cancelPending(): void {
    if (pending) {
      clearTimeout(pending.timer);
      pending = null;
    }
  }
  return {
    ...store,
    openDialog(d: Dialog): void {
      store.openDialog(d);
    },
    confirmDelete(): void {
      const d = store.dialog();
      const id = d && d.kind === 'delete' ? d.id : null;
      // Flip the page mirror immediately (launcher updates + Undo toast).
      store.confirmDelete();
      if (id && deps.onDiskDelete) {
        const timer = setTimeout(() => {
          deps.onDiskDelete?.(id);
          pending = null;
        }, DELETE_GRACE_MS);
        pending = { id, timer };
      }
    },
    undoDelete(): void {
      // Cancel the pending on-disk delete FIRST — an Undo never deletes the tree.
      cancelPending();
      store.undoDelete();
    },
  };
}
