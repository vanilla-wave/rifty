import { describe, expect, it } from 'vitest';
import { resolveBootstrapConfig } from '../templates/project-spec.ts';
import { allProjectSpecs } from '../templates/registry.ts';
import { VITE_TEMPLATE } from '../templates/vite.ts';
import { programMirrorPath } from './program-path.ts';

describe('programMirrorPath (ADR-0165 §4 — root-relative editor program mirror)', () => {
  it('derives the entry path under the active scratch root', () => {
    expect(programMirrorPath('/scratch', VITE_TEMPLATE)).toBe('/scratch/src/main.js');
  });

  it('derives the entry path under a named project root', () => {
    expect(programMirrorPath('/projects/p1', VITE_TEMPLATE)).toBe('/projects/p1/src/main.js');
  });

  it('is no longer hardcoded to the legacy /workspace root', () => {
    expect(programMirrorPath('/projects/p1', VITE_TEMPLATE)).not.toBe('/workspace/src/main.js');
    expect(programMirrorPath('/scratch', VITE_TEMPLATE)).not.toContain('/workspace/');
  });

  it('matches every template bootstrap entry path', () => {
    for (const spec of allProjectSpecs()) {
      const cfg = resolveBootstrapConfig(spec, spec.defaultPort, '/scratch');
      expect(programMirrorPath('/scratch', spec), spec.id).toBe(cfg.entryPath);
    }
  });
});
