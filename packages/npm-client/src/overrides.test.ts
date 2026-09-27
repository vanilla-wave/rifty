import { describe, expect, it } from 'vitest';
import { resolveOverride } from './overrides.ts';

describe('npm override target spelling', () => {
  it.each(['8.0.16', '^8.0.0', '~8.0.16', '>=8 <9', '*'])(
    'keeps the dependency name for %s',
    (range) => {
      expect(resolveOverride('vite', 'vitest', { vite: range })).toEqual({
        name: 'vite',
        range,
        source: 'user',
      });
    },
  );

  it('applies a parent-scoped version before a global version', () => {
    expect(resolveOverride('vite', 'vitest', { 'vitest>vite': '8.0.16', vite: '8.0.0' })).toEqual({
      name: 'vite',
      range: '8.0.16',
      source: 'user',
    });
  });

  it.each(['vite@8.0.16', 'npm:vite@8.0.16'])(
    'preserves explicit package targets: %s',
    (target) => {
      expect(resolveOverride('vite', undefined, { vite: target })).toEqual({
        name: 'vite',
        range: '8.0.16',
        source: 'user',
      });
    },
  );

  it('preserves baked bare-package substitution', () => {
    expect(resolveOverride('bcrypt', undefined)).toMatchObject({
      name: 'bcryptjs',
      source: 'baked',
    });
  });
});
