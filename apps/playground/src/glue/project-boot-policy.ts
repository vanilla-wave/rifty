import type { ProjectIndex } from '@riftydev/workbench';

export function needsProjectChoiceOnBoot(index: ProjectIndex): boolean {
  return index.activeId === 'scratch' && index.scratch === null;
}

/**
 * Page-side project-presence hint: lets a TRUE first-run open the chooser
 * instantly instead of waiting ~1.5-3s for the first owner index publish
 * (index-driven anti-flash stays for returning users, whose hint is set).
 * Stale-hint edges degrade to today's behavior: hint absent but a project
 * exists → the first publish closes the chooser and restores (rare: storage
 * cleared selectively); hint present but storage empty → index-driven open.
 */
const PROJECT_PRESENCE_HINT_KEY = 'rifty.hasActiveProject';

export function hasPersistedProjectHint(
  storage: Storage | undefined = globalThis.localStorage,
): boolean {
  try {
    return storage?.getItem(PROJECT_PRESENCE_HINT_KEY) === '1';
  } catch {
    return false; // private mode / storage denied → treat as first run
  }
}

export function recordProjectPresenceHint(
  index: ProjectIndex,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  try {
    if (needsProjectChoiceOnBoot(index)) storage?.removeItem(PROJECT_PRESENCE_HINT_KEY);
    else storage?.setItem(PROJECT_PRESENCE_HINT_KEY, '1');
  } catch {
    // storage denied → the next boot just falls back to index-driven timing
  }
}
