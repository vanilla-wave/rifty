/**
 * Unit tests for `ModuleRegistry.invalidate(id?)`.
 *
 * Closes the "ModuleLoader recreated per `load-fixture`" finding from the
 * 2026-05-26 architecture review (Tier 1 #4): granular invalidation lets the
 * worker entry keep the loader instance alive and only drop the entries that
 * actually changed, instead of throwing away the whole module cache on every
 * editor save.
 */
import { describe, expect, it } from 'vitest';
import { ModuleRegistry } from './registry.ts';

describe('ModuleRegistry.invalidate(id?)', () => {
  it('full reset clears every entry when called with no id', () => {
    const reg = new ModuleRegistry();
    const a = reg.getOrCreate('/a.js', 'cjs');
    a.state = 'loaded';
    const b = reg.getOrCreate('/b.js', 'cjs');
    b.state = 'loaded';
    expect(reg.has('/a.js')).toBe(true);
    expect(reg.has('/b.js')).toBe(true);

    reg.invalidate();

    expect(reg.has('/a.js')).toBe(false);
    expect(reg.has('/b.js')).toBe(false);
    expect(reg.get('/a.js')).toBeUndefined();
    expect(reg.get('/b.js')).toBeUndefined();
  });

  it('targeted invalidate removes one entry and leaves siblings intact', () => {
    const reg = new ModuleRegistry();
    const a = reg.getOrCreate('/a.js', 'cjs');
    a.state = 'loaded';
    a.exports = { value: 'A' };
    const b = reg.getOrCreate('/b.js', 'cjs');
    b.state = 'loaded';
    b.exports = { value: 'B' };
    const c = reg.getOrCreate('/c.js', 'cjs');
    c.state = 'loaded';
    c.exports = { value: 'C' };

    reg.invalidate('/b.js');

    expect(reg.has('/a.js')).toBe(true);
    expect(reg.has('/b.js')).toBe(false);
    expect(reg.has('/c.js')).toBe(true);
    expect(reg.get('/a.js')?.exports).toEqual({ value: 'A' });
    expect(reg.get('/c.js')?.exports).toEqual({ value: 'C' });
  });

  it('targeted invalidate on a missing id is a no-op (does not throw, does not affect siblings)', () => {
    const reg = new ModuleRegistry();
    const a = reg.getOrCreate('/a.js', 'cjs');
    a.state = 'loaded';

    expect(() => reg.invalidate('/does-not-exist.js')).not.toThrow();
    expect(reg.has('/a.js')).toBe(true);
  });
});
