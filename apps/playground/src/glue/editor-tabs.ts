/**
 * Pure tab/document reducer for the multi-model editor (ADR-0075).
 *
 * Solid-free so the invariants e2e selectors depend on are unit-testable:
 *  - the program tab ({@link PROGRAM_TAB_ID}) is always index 0 and non-closable
 *    — it stays bound to `machine.source`/`setSource`, keeping the
 *    real-vite HMR textarea path unchanged;
 *  - file tabs are keyed by absolute VFS path; opening the same path twice is
 *    idempotent (re-activates), preventing two models over one path.
 */

export type TabKind = 'program' | 'file' | 'diff';

export interface ProgramEditorTab {
  /** Stable id: `__program__` for the program tab. */
  readonly id: string;
  readonly kind: 'program';
  readonly title: string;
  readonly dirty: false;
}

export interface FileEditorTab {
  /** Stable id: absolute VFS path. */
  readonly id: string;
  readonly kind: 'file';
  readonly title: string;
  /** Absolute VFS path. */
  readonly path: string;
  /** Unsaved-changes dot. */
  readonly dirty: boolean;
}

export interface DiffEditorTab {
  /** Stable id: `diff:<ref>:<absolute VFS path>`. */
  readonly id: string;
  readonly kind: 'diff';
  readonly title: string;
  /** Absolute VFS path for the working side. */
  readonly path: string;
  /** Diff tabs compare a read-only original against the working model. */
  readonly originalTitle: string;
  readonly modifiedTitle: string;
  readonly dirty: false;
}

export type EditorTab = ProgramEditorTab | FileEditorTab | DiffEditorTab;
export type DiffEditorTabInput = Omit<DiffEditorTab, 'kind' | 'dirty'> &
  Partial<Pick<DiffEditorTab, 'kind' | 'dirty'>>;

export const PROGRAM_TAB_ID = '__program__';

/** Starting tab list: just the program tab. */
export function initialTabs(programTitle: string): EditorTab[] {
  return [{ id: PROGRAM_TAB_ID, kind: 'program', title: programTitle, dirty: false }];
}

/**
 * Add a file tab for `path`. Idempotent — unchanged if a tab for that path
 * exists. File tabs sort after the program tab.
 */
export function openFileTab(tabs: readonly EditorTab[], path: string, title: string): EditorTab[] {
  if (tabs.some((t) => t.id === path)) return [...tabs];
  return [...tabs, { id: path, kind: 'file', title, path, dirty: false }];
}

export function openDiffTab(tabs: readonly EditorTab[], tab: DiffEditorTabInput): EditorTab[] {
  if (tabs.some((t) => t.id === tab.id)) return [...tabs];
  return [...tabs, { ...tab, kind: 'diff', dirty: false }];
}

/** Close a tab. The program tab is non-closable (returns the list unchanged). */
export function closeTab(tabs: readonly EditorTab[], id: string): EditorTab[] {
  if (id === PROGRAM_TAB_ID) return [...tabs];
  return tabs.filter((t) => t.id !== id);
}

/**
 * Active tab after `closingId` is removed. Closing an inactive tab keeps the
 * active one; closing the active tab falls to its right neighbour, else left,
 * else the program tab.
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
