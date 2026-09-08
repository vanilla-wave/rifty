import { describe, expect, it } from 'vitest';
import { matchPreviewUrl } from '../src/preview-bridge.ts';

type MatchPreviewUrl = (
  pathname: string,
  prefix?: string,
) => { readonly port: number; readonly path: string } | null;

const match = matchPreviewUrl as MatchPreviewUrl;

describe('matchPreviewUrl prefixed paths (I5)', () => {
  it('matches /sandbox/preview/<port>/ when that prefix is selected', () => {
    expect(match('/sandbox/preview/5173/', '/sandbox/preview')).toEqual({
      port: 5173,
      path: '/',
    });
    expect(match('/sandbox/preview/5173/src/main.ts', '/sandbox/preview')).toEqual({
      port: 5173,
      path: '/src/main.ts',
    });
    expect(match('/preview/5173/', '/sandbox/preview')).toBeNull();
    expect(match('/api/preview/5173/', '/sandbox/preview')).toBeNull();
  });
});
