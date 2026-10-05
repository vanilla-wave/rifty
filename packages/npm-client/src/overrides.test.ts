import { describe, expect, it } from 'vitest';
import { resolveOverride } from './overrides.ts';

describe('npm override value spelling', () => {
  it.each(['8.0.16', '^8', '~8.0', '>=8 <9', '*'])('keeps the package identity for %s', (range) => {
    expect(resolveOverride('vite', 'vitest', { vite: range })).toEqual({
      name: 'vite',
      range,
      source: 'user',
    });
  });

  it('keeps explicit package aliases and rifty name@range', () => {
    for (const target of ['npm:replacement@2.0.0', 'replacement@2.0.0']) {
      expect(resolveOverride('original', undefined, { original: target })).toEqual({
        name: 'replacement',
        range: '2.0.0',
        source: 'user',
      });
    }
    expect(resolveOverride('original', undefined, { original: 'npm:replacement' })).toEqual({
      name: 'replacement',
      range: null,
      source: 'user',
    });
  });
});
