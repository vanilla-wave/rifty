import { describe, expect, it } from 'vitest';
import { resolveBootstrapConfig } from '../templates/project-spec.ts';
import { TYPESCRIPT_TEMPLATE } from '../templates/typescript.ts';
import { withoutProjectNodeModulesFiles } from './project-seed-paths.ts';
import { seedFilesForStarter, starterById } from './starter.ts';

const ROOT = '/project';

describe('withoutProjectNodeModulesFiles', () => {
  it('keeps a prefix sibling in project template seeds while excluding package descendants', () => {
    const config = resolveBootstrapConfig(
      TYPESCRIPT_TEMPLATE,
      TYPESCRIPT_TEMPLATE.defaultPort,
      ROOT,
    );
    const sibling = `${ROOT}/node_modules-evil/template.ts`;
    const files = withoutProjectNodeModulesFiles(ROOT, {
      ...config.seedFiles,
      [sibling]: 'project-template',
      [`${ROOT}/node_modules`]: 'corrupt-file',
    });

    expect(files[sibling]).toBe('project-template');
    expect(files[`${ROOT}/node_modules`]).toBeUndefined();
    expect(files[`${ROOT}/node_modules/@rifty/example-types/index.d.ts`]).toBeUndefined();
  });

  it('keeps a prefix sibling in starter baselines while excluding package descendants', () => {
    const sibling = `${ROOT}/node_modules-evil/starter.ts`;
    const derived = `${ROOT}/node_modules/generated/index.js`;
    const files = withoutProjectNodeModulesFiles(ROOT, {
      ...seedFilesForStarter(starterById('project-files'), ROOT),
      [sibling]: 'starter-baseline',
      [`${ROOT}/node_modules`]: 'corrupt-file',
      [derived]: 'derived',
    });

    expect(files[sibling]).toBe('starter-baseline');
    expect(files[`${ROOT}/node_modules`]).toBeUndefined();
    expect(files[derived]).toBeUndefined();
  });
});
