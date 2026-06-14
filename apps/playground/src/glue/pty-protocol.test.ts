import { describe, expect, it } from 'vitest';
import { type PtyFrame, isOwnerToPage, isPageToOwner } from './pty-protocol.ts';

describe('pty-protocol', () => {
  it('classifies page→owner frames', () => {
    const f: PtyFrame = {
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'ls',
      cols: 80,
      rows: 24,
      isTTY: true,
    };
    expect(isPageToOwner(f)).toBe(true);
    expect(isOwnerToPage(f)).toBe(false);
  });
  it('classifies owner→page frames', () => {
    const f: PtyFrame = { type: 'pty:exit', sid: 's1', rid: 'r1', code: 0, cwd: '/', env: {} };
    expect(isOwnerToPage(f)).toBe(true);
    expect(isPageToOwner(f)).toBe(false);
  });
  it('chunk frames carry Uint8Array data + monotonic seq shape', () => {
    const f: PtyFrame = {
      type: 'pty:chunk',
      sid: 's',
      rid: 'r',
      stream: 'stdout',
      seq: 0,
      data: new Uint8Array([1]),
    };
    expect(f.data).toBeInstanceOf(Uint8Array);
    expect(isOwnerToPage(f)).toBe(true);
  });
});
