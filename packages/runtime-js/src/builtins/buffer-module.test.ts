import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import nodeBuffer from './buffer.ts';

const m = nodeBuffer as Record<string, unknown> & {
  resolveObjectURL: (id: string) => never;
  INSPECT_MAX_BYTES: number;
};

describe('node:buffer module surface', () => {
  it('resolveObjectURL loud-throws (no real cross-realm blob registry — Fidelity)', () => {
    // Node SUPPORTS resolveObjectURL; rifty has no introspectable
    // URL.createObjectURL registry, so it's a loud gap, never a silent undefined.
    expect(() => m.resolveObjectURL('blob:nodedata:abc')).toThrow(NotImplementedError);
  });

  it('INSPECT_MAX_BYTES is a live getter/setter over the shared io cell', () => {
    expect(m.INSPECT_MAX_BYTES).toBe(50);
    m.INSPECT_MAX_BYTES = 12;
    expect(m.INSPECT_MAX_BYTES).toBe(12);
    m.INSPECT_MAX_BYTES = 50; // restore the shared cell
  });

  it('re-exports SlowBuffer / isUtf8 / isAscii / Blob', () => {
    expect(typeof m.SlowBuffer).toBe('function');
    expect(typeof m.isUtf8).toBe('function');
    expect(typeof m.isAscii).toBe('function');
    expect(typeof m.Blob).toBe('function');
  });
});
