/**
 * Pure tab/document reducer for the multi-model editor (ADR-0075).
 *
 * The editor host owns one Monaco instance and one `ITextModel` per tab; this
 * module is the Solid-free state logic so the invariants every e2e selector
 * leans on are unit-testable:
 *
 *  - the permanent **program tab** ({@link PROGRAM_TAB_ID}) is always index 0
 *    and can never be closed — it stays bound to `machine.source`/`setSource`,
 *    so REPL Run and the dev/real-vite HMR textarea path are unchanged;
 *  - file tabs are keyed by their absolute VFS path (opening the same path
 *    twice is idempotent — just re-activates), which also prevents two models
 *    over one path.
 */

export type TabKind = 'program' | 'file';

export interface EditorTab {
  /** Stable id. `__program__` for the program tab; the absolute path for files. */
  readonly id: string;
  readonly kind: TabKind;
  /** Tab-strip label. */
  readonly title: string;
  /** Absolute VFS path — set only for `kind: 'file'`. */
  readonly path?: string;
  /** Unsaved-changes dot (file tabs only). */
  readonly dirty: boolean;
}

export const PROGRAM_TAB_ID = '__program__';

/** The starting tab list: just the (active) program tab. */
export function initialTabs(programTitle: string): EditorTab[] {
  return [{ id: PROGRAM_TAB_ID, kind: 'program', title: programTitle, dirty: false }];
}

/**
 * Add a file tab for `path` (idempotent — returns the list unchanged if a tab
 * for that path already exists). File tabs always sort after the program tab.
 */
export function openFileTab(tabs: readonly EditorTab[], path: string, title: string): EditorTab[] {
  if (tabs.some((t) => t.id === path)) return [...tabs];
  return [...tabs, { id: path, kind: 'file', title, path, dirty: false }];
}

/** Close a tab. The program tab is non-closable (returns the list unchanged). */
export function closeTab(tabs: readonly EditorTab[], id: string): EditorTab[] {
  if (id === PROGRAM_TAB_ID) return [...tabs];
  return tabs.filter((t) => t.id !== id);
}

/**
 * Which tab should be active after `closingId` is removed, given the current
 * `activeId`. Closing an inactive tab keeps the active one; closing the active
 * tab falls to its right neighbour, else its left, else the program tab.
 */
export function nextActiveAfterClose(
  tabs: readonly EditorTab[],
  closingId: string,
  activeId: string,
): string {
  if (closingId !== activeId) return activeId;
  const idx = tabs.findIndex((t) => t.id === closingId);
  if (idx === -1) return activeId;
  const right = tabs[idx + 1];
  const left = tabs[idx - 1];
  return (right ?? left)?.id ?? PROGRAM_TAB_ID;
}

/** Set the dirty flag on a file tab (program tab is never dirty-tracked). */
export function setDirty(tabs: readonly EditorTab[], id: string, dirty: boolean): EditorTab[] {
  return tabs.map((t) => (t.id === id && t.kind === 'file' ? { ...t, dirty } : t));
}

/** Update the program tab's label (mode/preset entry name). */
export function setProgramTitle(tabs: readonly EditorTab[], title: string): EditorTab[] {
  return tabs.map((t) => (t.id === PROGRAM_TAB_ID ? { ...t, title } : t));
}
