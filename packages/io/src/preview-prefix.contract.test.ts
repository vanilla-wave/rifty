/** I5 Contract+RED; native scope/query oracle recorded by PR316 pickup. */
import { describe, expect, it } from 'vitest';
import * as protocol from './preview-protocol.ts';

interface PrefixApi {
  normalizePreviewPrefix?(value: unknown): string;
  buildPreviewPath?(port: number, prefix?: string): string;
  previewPrefixPattern?(prefix?: string): RegExp;
  parsePreviewPath(path: string, prefix?: string): { port: number; rest: string } | null;
}
const api = protocol as unknown as PrefixApi;

describe('I5 canonical preview prefix', () => {
  it('parses configured paths and preserves guest suffix bytes', () => {
    expect(api.parsePreviewPath('/sandbox/p/5173/a%2Fb/%20x', '/sandbox/p/')).toEqual({
      port: 5173,
      rest: '/a%2Fb/%20x',
    });
    expect(api.parsePreviewPath('/sandbox/p/5173', '/sandbox/p/')).toEqual({
      port: 5173,
      rest: '/',
    });
  });

  it('does not retain an implicit default route when a different prefix is selected', () => {
    expect(api.parsePreviewPath('/preview/5173/', '/sandbox/p/')).toBeNull();
    expect(api.parsePreviewPath('/sandbox/p-other/5173/', '/sandbox/p/')).toBeNull();
  });

  it('keeps default addressing and upstream Host unchanged', () => {
    expect(api.parsePreviewPath('/preview/05173/x')).toEqual({ port: 5173, rest: '/x' });
    expect(protocol.synthesizePreviewUrl('/x?q=1', 5173)).toBe('http://localhost:5173/x?q=1');
  });

  it('normalizes one URL pathname without trimming or decoding twice', () => {
    expect(api.normalizePreviewPrefix?.('/sandbox/a/../проба space')).toBe(
      '/sandbox/%D0%BF%D1%80%D0%BE%D0%B1%D0%B0%20space/',
    );
    expect(api.normalizePreviewPrefix?.('/sandbox/%252f/')).toBe('/sandbox/%252f/');
    expect(api.normalizePreviewPrefix?.('/sandbox/a ')).toBe('/sandbox/a%20/');
    expect(api.normalizePreviewPrefix?.('/')).toBe('/');
  });

  it.each([
    '',
    'relative/',
    '//host/p/',
    ' /sandbox/p/',
    '/a\\b/',
    '/p?x',
    '/p#x',
    '/p\n/',
    '/p\t/',
    '/p\0/',
    '/p%2f/',
    '/p%5C/',
    null,
    17,
  ])('refuses non-path or ambiguous prefix %j', (value) => {
    expect(api.normalizePreviewPrefix).toBeTypeOf('function');
    expect(() => api.normalizePreviewPrefix?.(value)).toThrow(TypeError);
  });

  it('builds the host route and exposes exactly the same pattern to generated WS code', () => {
    const prefix = '/sandbox/a.b+/';
    expect(api.buildPreviewPath?.(5173, prefix)).toBe('/sandbox/a.b+/5173/');
    expect(api.buildPreviewPath?.(5173)).toBe('/preview/5173/');
    const pattern = api.previewPrefixPattern?.(prefix);
    expect(pattern).toBeInstanceOf(RegExp);
    const transported =
      pattern === undefined ? undefined : new RegExp(pattern.source, pattern.flags);
    expect(transported?.exec('/sandbox/a.b+/5173/path')?.slice(1)).toEqual(['5173', '/path']);
    expect(transported?.test('/sandbox/axb/5173/path')).toBe(false);
    expect(api.parsePreviewPath('/sandbox/a.b+/5173/path', prefix)).toEqual({
      port: 5173,
      rest: '/path',
    });
  });
});
