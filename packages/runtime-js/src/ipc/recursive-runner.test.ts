import { describe, expect, it } from 'vitest';
import { resetNodeEntryWorkerUrl } from '../builtins/node-entry-url.ts';
import { buildRecursiveWorkerEnv, makeRecursiveRunner } from './recursive-runner.ts';

describe('makeRecursiveRunner', () => {
  it('applies host bootstrap config after the user-visible child env', () => {
    expect(
      buildRecursiveWorkerEnv(
        { USER_VALUE: 'explicit', RIFTY_SQLITE_WASM_URL: 'user-value' },
        { RIFTY_SQLITE_WASM_URL: 'host-value' },
      ),
    ).toEqual({
      USER_VALUE: 'explicit',
      RIFTY_SQLITE_WASM_URL: 'host-value',
      RIFTY_BIN: '0',
      RIFTY_REMOTE_FS: '1',
    });
  });

  it('fails loud when the node-entry worker URL is not configured', () => {
    resetNodeEntryWorkerUrl();
    const run = makeRecursiveRunner();

    expect(() =>
      run({
        entryPath: '/missing.js',
        argv: ['rifty', '/missing.js'],
        env: {},
        cwd: '/',
      }),
    ).toThrow(/node-entry worker URL not configured/);
  });
});
