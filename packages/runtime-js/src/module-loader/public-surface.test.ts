import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import * as nodeEntryBuiltin from '../builtins/node-entry.ts';
import * as publicLoader from './index.ts';
import { type ModuleLoader, createModuleLoader } from './index.ts';

type ExpectedPublicKey = 'require' | 'import' | 'loadById' | 'invalidate' | 'registry' | 'resolver';
type NoUnexpectedPublicKey = Exclude<keyof ModuleLoader, ExpectedPublicKey> extends never
  ? true
  : false;

describe('ModuleLoader public surface', () => {
  it('does not widen for package-internal execution mechanisms', () => {
    const noUnexpectedTypeKey: NoUnexpectedPublicKey = true;
    const loader = createModuleLoader(new MemoryFsSync());

    expect(noUnexpectedTypeKey).toBe(true);
    expect(Object.keys(publicLoader).sort()).toEqual(['ModuleLoadError', 'createModuleLoader']);
    expect(Object.keys(nodeEntryBuiltin).sort()).toEqual([
      'parseBinLauncherTarget',
      'runNodeEntry',
    ]);
    expect(Object.keys(loader).sort()).toEqual([
      'import',
      'invalidate',
      'loadById',
      'registry',
      'require',
      'resolver',
    ]);
  });
});
