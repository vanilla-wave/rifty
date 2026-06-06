/**
 * Unit tests for the URL parsing piece of the preview bridge. The runtime
 * round-trip (Service Worker ↔ window) is verified in the E2E suite — these
 * tests just lock in the matcher contract.
 */
import { describe, expect, it } from 'vitest';
import { isPreviewFrameRequest, matchPreviewUrl } from '../src/preview-bridge.ts';

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

describe('isPreviewFrameRequest (ADR-0074 owner routing)', () => {
  it('treats the iframe document navigation as from the preview frame', () => {
    expect(isPreviewFrameRequest({ mode: 'navigate', destination: 'iframe' })).toBe(true);
    // a navigation can also surface destination 'document'
    expect(isPreviewFrameRequest({ mode: 'navigate', destination: 'document' })).toBe(true);
  });

  it('treats iframe subresources (non-empty destination) as from the preview frame', () => {
    expect(isPreviewFrameRequest({ mode: 'cors', destination: 'script' })).toBe(true);
    expect(isPreviewFrameRequest({ mode: 'no-cors', destination: 'style' })).toBe(true);
    expect(isPreviewFrameRequest({ mode: 'cors', destination: 'image' })).toBe(true);
  });

  it("does NOT match the page's own bare fetch warm-up (empty destination, not a navigation)", () => {
    expect(isPreviewFrameRequest({ mode: 'cors', destination: '' })).toBe(false);
    expect(isPreviewFrameRequest({ mode: 'no-cors', destination: '' })).toBe(false);
  });
});
