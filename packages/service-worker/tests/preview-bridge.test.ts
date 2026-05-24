/**
 * Unit tests for the URL parsing piece of the preview bridge. The runtime
 * round-trip (Service Worker ↔ window) is verified in the E2E suite — these
 * tests just lock in the matcher contract.
 */
import { describe, expect, it } from 'vitest';
import { matchPreviewUrl } from '../src/preview-bridge.ts';

describe('matchPreviewUrl', () => {
  it('matches /preview/<port>/ with a numeric port', () => {
    expect(matchPreviewUrl('/preview/3000/')).toEqual({ port: 3000, path: '/' });
    expect(matchPreviewUrl('/preview/8080/foo/bar')).toEqual({ port: 8080, path: '/foo/bar' });
  });

  it('matches the bare /preview/<port> form (no trailing slash)', () => {
    expect(matchPreviewUrl('/preview/5173')).toEqual({ port: 5173, path: '/' });
  });

  it('returns null for non-preview paths', () => {
    expect(matchPreviewUrl('/')).toBeNull();
    expect(matchPreviewUrl('/preview')).toBeNull();
    expect(matchPreviewUrl('/preview/notaport/x')).toBeNull();
    expect(matchPreviewUrl('/api/preview/3000/')).toBeNull();
  });
});
