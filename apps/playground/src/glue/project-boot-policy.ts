import type { ProjectIndex } from './project-index.ts';

export function needsProjectChoiceOnBoot(index: ProjectIndex): boolean {
  return index.activeId === 'scratch' && index.scratch === null;
}
