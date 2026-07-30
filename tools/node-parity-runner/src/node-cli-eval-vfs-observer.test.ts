import { describe, expect, it } from 'vitest';
import { NodeCliEvalVfsObserver } from './node-cli-eval-vfs-observer.ts';

describe('NodeCliEvalVfsObserver', () => {
  it('retains transient write and unlink history after the final tree matches setup', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.loadFixture({ '/marker.cjs': "module.exports='marker'\n" });
    fs.startObservation();

    fs.writeFileSync('/.rifty-eval-transient.cjs', new TextEncoder().encode('source'));
    fs.rmSync('/.rifty-eval-transient.cjs', { force: true });

    expect(fs.existsSync('/.rifty-eval-transient.cjs')).toBe(false);
    expect(fs.mutations()).toEqual([
      { kind: 'write', path: '/.rifty-eval-transient.cjs' },
      { kind: 'rm', path: '/.rifty-eval-transient.cjs' },
    ]);
  });
});
