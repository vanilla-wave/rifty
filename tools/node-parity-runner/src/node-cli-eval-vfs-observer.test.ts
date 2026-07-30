import { describe, expect, it } from 'vitest';
import { NodeCliEvalVfsObserver } from './node-cli-eval-vfs-observer.ts';

describe('NodeCliEvalVfsObserver', () => {
  it('subtracts exact guest effects without hiding a transient carrier', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.loadFixture({ '/marker.cjs': "module.exports='marker'\n" });
    fs.startObservation();

    fs.writeFileSync('/.rifty-eval-transient.cjs', new TextEncoder().encode('source'));
    fs.rmSync('/.rifty-eval-transient.cjs', { force: true });
    fs.writeFileSync('/guest-authored.txt', new TextEncoder().encode('guest'));

    expect(fs.existsSync('/.rifty-eval-transient.cjs')).toBe(false);
    expect(new TextDecoder().decode(fs.readFileBytesSync('/guest-authored.txt'))).toBe('guest');
    expect(fs.audit([{ kind: 'write', path: '/guest-authored.txt' }])).toEqual({
      missing: [],
      unexpected: [
        { kind: 'write', path: '/.rifty-eval-transient.cjs' },
        { kind: 'rm', path: '/.rifty-eval-transient.cjs' },
      ],
    });
  });

  it('keeps a missing declared guest effect loud', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.startObservation();

    expect(fs.audit([{ kind: 'write', path: '/missing.txt' }])).toEqual({
      missing: [{ kind: 'write', path: '/missing.txt' }],
      unexpected: [],
    });
  });
});
