import { describe, expect, it } from 'vitest';
import { resolveOverride } from './overrides.ts';

describe('npm bare-version override spelling', () => {
  it('parses a bare version as a range of the overridden package', () => {
    expect(resolveOverride('vite', undefined, { vite: '8.0.16' })).toEqual({
      name: 'vite',
      range: '8.0.16',
      source: 'user',
    });
  });

  it('keeps the rifty name@range spelling', () => {
    expect(resolveOverride('vite', undefined, { vite: 'vite@8.0.16' })).toEqual({
      name: 'vite',
      range: '8.0.16',
      source: 'user',
    });
  });

  it('applies a bare version on a parent>child key to the child name', () => {
    expect(resolveOverride('ms', 'debug', { 'debug>ms': '2.0.0' })).toEqual({
      name: 'ms',
      range: '2.0.0',
      source: 'user',
    });
  });

  it('still treats a bare package name as a replacement name', () => {
    expect(resolveOverride('foo', undefined, { foo: 'bar' })).toEqual({
      name: 'bar',
      range: null,
      source: 'user',
    });
  });
});
