import { describe, expect, it } from 'vitest';
import {
  LAUNCHER_TAB_KEY,
  initialLauncherTab,
  loadLauncherTab,
  saveLauncherTab,
} from './launcher-prefs.ts';
import type { StorageLike } from './layout-store.ts';

function fakeStorage(
  initial: Record<string, string> = {},
): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe('initialLauncherTab (ADR-0165 §9)', () => {
  it('forces STARTERS when there are no saved projects (overrides the remembered tab)', () => {
    expect(initialLauncherTab(0, null)).toBe('starters');
    expect(initialLauncherTab(0, 'projects')).toBe('starters');
    expect(initialLauncherTab(0, 'starters')).toBe('starters');
  });
  it('uses the remembered tab when projects exist (default Projects)', () => {
    expect(initialLauncherTab(3, null)).toBe('projects');
    expect(initialLauncherTab(3, 'starters')).toBe('starters');
    expect(initialLauncherTab(1, 'projects')).toBe('projects');
  });
});

describe('loadLauncherTab / saveLauncherTab', () => {
  it('round-trips a valid tab', () => {
    const s = fakeStorage();
    saveLauncherTab(s, 'starters');
    expect(s.map.get(LAUNCHER_TAB_KEY)).toBe('starters');
    expect(loadLauncherTab(s)).toBe('starters');
  });
  it('returns null on a missing / malformed value', () => {
    expect(loadLauncherTab(fakeStorage())).toBeNull();
    expect(loadLauncherTab(fakeStorage({ [LAUNCHER_TAB_KEY]: 'garbage' }))).toBeNull();
  });
  it('is a safe no-op when storage is absent (private mode / SSR)', () => {
    expect(loadLauncherTab(undefined)).toBeNull();
    expect(() => saveLauncherTab(undefined, 'projects')).not.toThrow();
  });
  it('swallows storage throws (quota / private mode)', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadLauncherTab(throwing)).toBeNull();
    expect(() => saveLauncherTab(throwing, 'starters')).not.toThrow();
  });
});
