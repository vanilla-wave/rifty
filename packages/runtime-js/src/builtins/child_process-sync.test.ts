import { describe, expect, it } from 'vitest';
import { resolveExecSyncOptions } from './child_process-sync.ts';

describe('resolveExecSyncOptions', () => {
  it('inherits the parent environment when execSync options omit env', () => {
    const parentEnv = { RIFTY_SQLITE_WASM_URL: 'blob:sqlite', USER_VALUE: 'parent' };

    const resolved = resolveExecSyncOptions(undefined, parentEnv, '/parent');
    expect(resolved).toEqual({
      cwd: '/parent',
      env: parentEnv,
    });
    expect(resolved.env).not.toBe(parentEnv);
    parentEnv.USER_VALUE = 'mutated';
    expect(resolved.env?.USER_VALUE).toBe('parent');
    expect(resolveExecSyncOptions({ cwd: '/work' }, parentEnv, '/parent')).toEqual({
      cwd: '/work',
      env: parentEnv,
    });
  });

  it('uses an explicit env as a replacement instead of merging the parent', () => {
    expect(
      resolveExecSyncOptions(
        { env: { USER_VALUE: 'explicit' } },
        { RIFTY_SQLITE_WASM_URL: 'blob:sqlite', USER_VALUE: 'parent' },
        '/parent',
      ),
    ).toEqual({ cwd: '/parent', env: { USER_VALUE: 'explicit' } });
  });
});
