/**
 * Persisted launcher-tab preference (ADR-0165 §9): which tab the project launcher
 * opens on. Solid-free + storage-injected (mirrors layout-store.ts) so the
 * resolution is unit-testable without `localStorage`. Rule: open on STARTERS when
 * there are no saved projects yet (nothing to switch to — you can only pick one),
 * otherwise the remembered tab (default Projects).
 */
import type { StorageLike } from './layout-store.ts';
import type { LauncherTab } from './page-store.ts';

export const LAUNCHER_TAB_KEY = 'rf.launcher.tab';

function isTab(v: unknown): v is LauncherTab {
  return v === 'projects' || v === 'starters';
}

/** Read the remembered tab, or null on miss / private-mode / malformed value. */
export function loadLauncherTab(storage: StorageLike | undefined): LauncherTab | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAUNCHER_TAB_KEY);
    return isTab(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist the active tab. Best-effort — swallows quota / private-mode failures. */
export function saveLauncherTab(storage: StorageLike | undefined, tab: LauncherTab): void {
  if (!storage) return;
  try {
    storage.setItem(LAUNCHER_TAB_KEY, tab);
  } catch {
    // launcher-tab persistence is never load-bearing.
  }
}

/**
 * The tab to OPEN the launcher on: STARTERS when there are no saved projects
 * (only a starter can be picked), else the remembered tab (default Projects).
 */
export function initialLauncherTab(
  projectCount: number,
  remembered: LauncherTab | null,
): LauncherTab {
  if (projectCount === 0) return 'starters';
  return remembered ?? 'projects';
}
