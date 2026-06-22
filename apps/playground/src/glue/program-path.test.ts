import { describe, expect, it } from 'vitest';
import { programMirrorPath } from './program-path.ts';

describe('programMirrorPath (ADR-0165 §4 — root-relative editor program mirror)', () => {
  it('derives the entry path under the active scratch root', () => {
    expect(programMirrorPath('/scratch')).toBe('/scratch/src/main.js');
  });

  it('derives the entry path under a named project root', () => {
    expect(programMirrorPath('/projects/p1')).toBe('/projects/p1/src/main.js');
  });

  it('is no longer hardcoded to the legacy /workspace root', () => {
    expect(programMirrorPath('/projects/p1')).not.toBe('/workspace/src/main.js');
    expect(programMirrorPath('/scratch')).not.toContain('/workspace/');
  });
});
