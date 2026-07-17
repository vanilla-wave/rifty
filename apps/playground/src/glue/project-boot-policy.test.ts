import { describe, expect, it, vi } from 'vitest';
import {
  hasPersistedProjectHint,
  needsProjectChoiceOnBoot,
  reconcileProjectChoiceOnBoot,
  recordProjectPresenceHint,
  shouldOpenInstantProjectChoice,
} from './project-boot-policy.ts';
import type { ProjectIndex } from './project-index.ts';

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

  it('tolerates an opaque-origin localStorage getter that throws before method access', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('opaque origin', 'SecurityError');
      },
    });
    try {
      expect(hasPersistedProjectHint()).toBe(false);
      expect(() =>
        recordProjectPresenceHint({ activeId: 'scratch', scratch: null, projects: [] }),
      ).not.toThrow();
      expect(() =>
        reconcileProjectChoiceOnBoot(
          { activeId: 'scratch', scratch: null, projects: [] },
          { openStarterChoice: vi.fn(), closeProjectChoice: vi.fn() },
        ),
      ).not.toThrow();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'localStorage');
      else Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });

  it('opens the starter chooser synchronously for a true first run', () => {
    const open = vi.fn();
    const close = vi.fn();
    const storage = fakeStorage();
    reconcileProjectChoiceOnBoot(
      { activeId: 'scratch', scratch: null, projects: [] },
      { openStarterChoice: open, closeProjectChoice: close },
      storage,
    );
    expect(open).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(hasPersistedProjectHint(storage)).toBe(false);
  });

  it('lets an explicit preset deep link pre-empt the speculative first-run chooser', () => {
    expect(shouldOpenInstantProjectChoice({ hasPersistedProject: false })).toBe(true);
    expect(
      shouldOpenInstantProjectChoice({
        hasPersistedProject: false,
        requestedStarterId: 'real-vite',
      }),
    ).toBe(false);
    expect(shouldOpenInstantProjectChoice({ hasPersistedProject: true })).toBe(false);
  });

  it('reconciles both stale hint directions from the authoritative catalog publish', () => {
    const storage = fakeStorage({ 'rifty.hasActiveProject': '1' });
    const open = vi.fn();
    const close = vi.fn();
    const actions = { openStarterChoice: open, closeProjectChoice: close };
    reconcileProjectChoiceOnBoot(
      { activeId: 'scratch', scratch: null, projects: [] },
      actions,
      storage,
    );
    expect(open).toHaveBeenCalledOnce();
    expect(hasPersistedProjectHint(storage)).toBe(false);

    reconcileProjectChoiceOnBoot(
      {
        activeId: 'p-1',
        scratch: null,
        projects: [{ id: 'p-1', name: 'Saved', starter: 'vite', editedAt: 'now' }],
      },
      actions,
      storage,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(hasPersistedProjectHint(storage)).toBe(true);
  });
});
