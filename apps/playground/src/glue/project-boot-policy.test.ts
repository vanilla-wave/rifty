import type { ProjectIndex } from '@riftydev/workbench';
import { describe, expect, it } from 'vitest';
import {
  hasPersistedProjectHint,
  needsProjectChoiceOnBoot,
  recordProjectPresenceHint,
} from './project-boot-policy.ts';

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: () => null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('needsProjectChoiceOnBoot', () => {
  it('requires the launcher when the boot index has no saved projects', () => {
    const index: ProjectIndex = { activeId: 'scratch', scratch: null, projects: [] };
    expect(needsProjectChoiceOnBoot(index)).toBe(true);
  });

  it('allows automatic boot when a scratch starter already exists', () => {
    const index: ProjectIndex = {
      activeId: 'scratch',
      scratch: { starter: 'project-files', dirty: false, editedAt: 'no edits yet' },
      projects: [],
    };
    expect(needsProjectChoiceOnBoot(index)).toBe(false);
  });

  it('allows automatic boot only when a saved project exists', () => {
    const index: ProjectIndex = {
      activeId: 'p-1',
      scratch: null,
      projects: [{ id: 'p-1', name: 'Saved app', starter: 'project-files', editedAt: 'just now' }],
    };
    expect(needsProjectChoiceOnBoot(index)).toBe(false);
  });
});

describe('project presence hint (instant first-run chooser)', () => {
  it('no hint recorded → first run, chooser opens without waiting for the index', () => {
    expect(hasPersistedProjectHint(fakeStorage())).toBe(false);
  });

  it('a publish with an active project records the hint; a needs-choice publish clears it', () => {
    const storage = fakeStorage();
    recordProjectPresenceHint(
      {
        activeId: 'scratch',
        scratch: { starter: 'project-files', dirty: true, editedAt: 'now' },
        projects: [],
      },
      storage,
    );
    expect(hasPersistedProjectHint(storage)).toBe(true);
    recordProjectPresenceHint({ activeId: 'scratch', scratch: null, projects: [] }, storage);
    expect(hasPersistedProjectHint(storage)).toBe(false);
  });

  it('tolerates an unavailable storage (private mode) — reads false, writes are no-ops', () => {
    expect(hasPersistedProjectHint(undefined)).toBe(false);
    expect(() =>
      recordProjectPresenceHint({ activeId: 'scratch', scratch: null, projects: [] }, undefined),
    ).not.toThrow();
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    expect(hasPersistedProjectHint(throwing)).toBe(false);
    expect(() =>
      recordProjectPresenceHint({ activeId: 'scratch', scratch: null, projects: [] }, throwing),
    ).not.toThrow();
  });
});
