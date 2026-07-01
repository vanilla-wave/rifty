import { describe, expect, it } from 'vitest';
import { needsProjectChoiceOnBoot } from './project-boot-policy.ts';
import type { ProjectIndex } from './project-index.ts';

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
