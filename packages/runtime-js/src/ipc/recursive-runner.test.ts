import { describe, expect, it } from 'vitest';
import { resetNodeEntryWorkerUrl } from '../builtins/node-entry-url.ts';
import { makeRecursiveRunner } from './recursive-runner.ts';

describe('makeRecursiveRunner', () => {
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
