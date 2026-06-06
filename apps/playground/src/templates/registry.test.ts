import { NotImplementedError } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_ID, defaultProjectSpec, resolveProjectSpec } from './registry.ts';

describe('resolveProjectSpec', () => {
  it('returns the vite spec for the default id and DEFAULT_TEMPLATE_ID resolves to it', () => {
    const spec = resolveProjectSpec('vite');
    expect(spec.id).toBe('vite');
    expect(spec.displayName.length).toBeGreaterThan(0);
    // pins the generic-naming requirement — a revert to "Real Vite" branding fails
    expect(spec.displayName).not.toBe('Real Vite');
    expect(spec.install).toHaveProperty('vite');

    expect(resolveProjectSpec(DEFAULT_TEMPLATE_ID)).toBe(spec);
    expect(defaultProjectSpec()).toBe(spec);
  });

  it('throws NotImplementedError for an unknown template id (no silent fallback)', () => {
    expect(() => resolveProjectSpec('svelte')).toThrow(NotImplementedError);
    expect(() => resolveProjectSpec('svelte')).toThrow(/templates\.resolveProjectSpec/);
    expect(() => resolveProjectSpec('svelte')).toThrow(/svelte/);
  });
});
