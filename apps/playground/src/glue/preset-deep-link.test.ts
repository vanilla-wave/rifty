import { describe, expect, it } from 'vitest';
import { parsePresetDeepLink } from './preset-deep-link.ts';

describe('parsePresetDeepLink', () => {
  it('reads preset id + autorun from ?preset=real-vite&autorun=1', () => {
    expect(parsePresetDeepLink('?preset=real-vite&autorun=1')).toEqual({
      presetId: 'real-vite',
      autorun: true,
    });
  });

  it('autorun defaults OFF without an explicit truthy flag', () => {
    expect(parsePresetDeepLink('?preset=real-vite')).toEqual({
      presetId: 'real-vite',
      autorun: false,
    });
  });

  it('accepts autorun=true as well as =1', () => {
    expect(parsePresetDeepLink('?preset=real-vite&autorun=true').autorun).toBe(true);
  });

  it('autorun=0 / other values stay OFF', () => {
    expect(parsePresetDeepLink('?preset=real-vite&autorun=0').autorun).toBe(false);
    expect(parsePresetDeepLink('?preset=real-vite&autorun=yes').autorun).toBe(false);
  });

  it('autorun is meaningless without a preset', () => {
    expect(parsePresetDeepLink('?autorun=1')).toEqual({ presetId: undefined, autorun: false });
  });

  it('empty / missing preset → undefined', () => {
    expect(parsePresetDeepLink('')).toEqual({ presetId: undefined, autorun: false });
    expect(parsePresetDeepLink('?preset=')).toEqual({ presetId: undefined, autorun: false });
  });

  it('tolerates a leading "?" being absent', () => {
    expect(parsePresetDeepLink('preset=real-vite&autorun=1')).toEqual({
      presetId: 'real-vite',
      autorun: true,
    });
  });
});
