import { describe, expect, it } from 'vitest';
import { withoutProjectNodeModulesFiles } from './project-seed-paths.ts';

const ROOT = '/project';

describe('withoutProjectNodeModulesFiles', () => {
  it('keeps a prefix sibling in project template seeds while excluding package descendants', () => {
    const sibling = `${ROOT}/node_modules-evil/template.ts`;
    const files = withoutProjectNodeModulesFiles(ROOT, {
      [`${ROOT}/src/main.ts`]: 'project-template',
      [sibling]: 'project-template',
      [`${ROOT}/node_modules`]: 'corrupt-file',
      [`${ROOT}/node_modules/@rifty/example-types/index.d.ts`]: 'derived',
    });

    expect(files[`${ROOT}/src/main.ts`]).toBe('project-template');
    expect(files[sibling]).toBe('project-template');
    expect(files[`${ROOT}/node_modules`]).toBeUndefined();
    expect(files[`${ROOT}/node_modules/@rifty/example-types/index.d.ts`]).toBeUndefined();
  });

  it('keeps a prefix sibling in starter baselines while excluding package descendants', () => {
    const sibling = `${ROOT}/node_modules-evil/starter.ts`;
    const derived = `${ROOT}/node_modules/generated/index.js`;
    const files = withoutProjectNodeModulesFiles(ROOT, {
      [`${ROOT}/README.md`]: 'starter-baseline',
      [sibling]: 'starter-baseline',
      [`${ROOT}/node_modules`]: 'corrupt-file',
      [derived]: 'derived',
    });

    expect(files[`${ROOT}/README.md`]).toBe('starter-baseline');
    expect(files[sibling]).toBe('starter-baseline');
    expect(files[`${ROOT}/node_modules`]).toBeUndefined();
    expect(files[derived]).toBeUndefined();
  });
});
