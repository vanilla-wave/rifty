/**
 * Pure tab/document reducer for the multi-model editor (ADR-0075).
 *
 * Solid-free so the invariants e2e selectors depend on are unit-testable:
 *  - file tabs are keyed by absolute VFS path; opening the same path twice is
 *    idempotent (re-activates), preventing two models over one path.
 */

export type TabKind = 'file' | 'diff';

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

export type EditorTab = FileEditorTab | DiffEditorTab;
export interface InitialFileTabInput {
  readonly path: string;
  readonly title: string;
}
export type DiffEditorTabInput = Omit<DiffEditorTab, 'kind' | 'dirty'> &
  Partial<Pick<DiffEditorTab, 'kind' | 'dirty'>>;

/** Starting tab list: ordered ordinary file tabs. */
export function initialTabs(files: readonly InitialFileTabInput[] = []): EditorTab[] {
  let tabs: EditorTab[] = [];
  for (const file of files) tabs = openFileTab(tabs, file.path, file.title);
  return tabs;
}

/**
 * Add a file tab for `path`. Idempotent — unchanged if a tab for that path
 * exists.
 */
export function openFileTab(tabs: readonly EditorTab[], path: string, title: string): EditorTab[] {
  if (tabs.some((t) => t.id === path)) return [...tabs];
  return [...tabs, { id: path, kind: 'file', title, path, dirty: false }];
}

export function openDiffTab(tabs: readonly EditorTab[], tab: DiffEditorTabInput): EditorTab[] {
  if (tabs.some((t) => t.id === tab.id)) return [...tabs];
  return [...tabs, { ...tab, kind: 'diff', dirty: false }];
}

/** Close a tab from the visible strip. */
export function closeTab(tabs: readonly EditorTab[], id: string): EditorTab[] {
  return tabs.filter((t) => t.id !== id);
}

/**
 * Active tab after `closingId` is removed. Closing an inactive tab keeps the
 * active one; closing the active tab falls to its right neighbour, else left,
 * else no active tab.
 */
export function nextActiveAfterClose(
  tabs: readonly EditorTab[],
  closingId: string,
  activeId: string,
): string | undefined {
  if (closingId !== activeId) return activeId;
  const idx = tabs.findIndex((t) => t.id === closingId);
  if (idx === -1) return activeId;
  const right = tabs[idx + 1];
  const left = tabs[idx - 1];
  return (right ?? left)?.id;
}

/** Set the dirty flag on editable tabs (diff tabs are read-only). */
export function setDirty(tabs: readonly EditorTab[], id: string, dirty: boolean): EditorTab[] {
  return tabs.map((t) => (t.id === id && t.kind === 'file' ? { ...t, dirty } : t));
}
