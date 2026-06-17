import { describe, expect, it } from 'vitest';
import { type OpenContext, classifyOpen } from './editor-open.ts';

const PROGRAM = '/workspace/src/main.js';

function ctx(over: Partial<OpenContext> = {}): OpenContext {
  return {
    programMirrorPath: PROGRAM,
    isNodeModules: false,
    present: false,
    readable: false,
    hasRemotePort: true,
    ...over,
  };
}

describe('classifyOpen', () => {
  it('routes the program-mirror path to the program tab', () => {
    expect(classifyOpen(PROGRAM, ctx({ present: true, readable: true }))).toBe('program');
  });

  it('routes node_modules to the view-only owner read-port', () => {
    expect(
      classifyOpen('/workspace/node_modules/left-pad/index.js', ctx({ isNodeModules: true })),
    ).toBe('remote');
  });

  it('reads a snapshot-readable file synchronously (editable)', () => {
    expect(classifyOpen('/workspace/src/util.js', ctx({ present: true, readable: true }))).toBe(
      'sync',
    );
  });

  // The bug: a just-seeded PROJECT file whose owner write has not yet been
  // reflected in the snapshot (absent, not present) must NOT be classified
  // view-only. It awaits the next snapshot frame and opens editable.
  it('awaits the snapshot for a seeded project file missing from the snapshot (not view-only)', () => {
    const cls = classifyOpen('/workspace/src/seeded.js', ctx({ present: false, readable: false }));
    expect(cls).toBe('await-snapshot');
    expect(cls).not.toBe('remote');
  });

  it('awaits the snapshot even with a remote port wired — a project file is editable', () => {
    expect(
      classifyOpen(
        '/workspace/styles.css',
        ctx({ present: false, readable: false, hasRemotePort: true }),
      ),
    ).toBe('await-snapshot');
  });

  // Present-but-over-cap (in the snapshot tree, no inlined bytes) is genuinely
  // view-only and unchanged — distinct from a racing seed (which is absent).
  it('keeps a present-but-over-cap project file view-only (remote)', () => {
    expect(classifyOpen('/workspace/big.json', ctx({ present: true, readable: false }))).toBe(
      'remote',
    );
  });

  // Absent + no snapshot source to await (plain mirror) → still await-snapshot;
  // the caller surfaces the read error when no `subscribe` exists.
  it('classifies an absent project file await-snapshot even without a remote port', () => {
    expect(
      classifyOpen('/workspace/src/seeded.js', ctx({ present: false, hasRemotePort: false })),
    ).toBe('await-snapshot');
  });
});
