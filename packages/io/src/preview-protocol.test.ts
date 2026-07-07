/**
 * Unit tests for the preview-protocol addressing primitives (ADR-0036).
 *
 * The behaviour pinned here is the same contract `@riftydev/service-worker`'s
 * `matchPreviewUrl` used to encode inline. Existing SW tests
 * (`packages/service-worker/tests/preview-bridge.test.ts`) still cover the
 * back-compat adapter shape; this suite covers the canonical helpers
 * directly so the io-side regression surface is independent of the SW.
 */
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_LOCAL_HOST,
  PREVIEW_PREFIX_RE,
  parsePreviewPath,
  synthesizePreviewUrl,
} from './preview-protocol.ts';

describe('parsePreviewPath', () => {
  it('parses /preview/<port>/<suffix> into port and suffix', () => {
    expect(parsePreviewPath('/preview/3000/foo')).toEqual({ port: 3000, rest: '/foo' });
    expect(parsePreviewPath('/preview/8080/foo/bar')).toEqual({ port: 8080, rest: '/foo/bar' });
    expect(parsePreviewPath('/preview/3000/')).toEqual({ port: 3000, rest: '/' });
  });

  it('treats the bare /preview/<port> form as rest = "/"', () => {
    // Matches the legacy SW behaviour: `matchPreviewUrl('/preview/5173')`
    // returned `{ port: 5173, path: '/' }`. parsePreviewPath inherits the
    // same suffix default so downstream URL synthesis is identical.
    expect(parsePreviewPath('/preview/5173')).toEqual({ port: 5173, rest: '/' });
  });

  it('returns null for paths that do not match the /preview/<port>/ shape', () => {
    expect(parsePreviewPath('/')).toBeNull();
    expect(parsePreviewPath('/preview')).toBeNull();
    expect(parsePreviewPath('/preview/notaport/x')).toBeNull();
    expect(parsePreviewPath('/api/preview/3000/')).toBeNull();
  });
});

describe('synthesizePreviewUrl', () => {
  it('stamps the Host a real local dev run would (localhost) — dev-server allow-lists pass untouched', () => {
    expect(synthesizePreviewUrl('/foo')).toBe('http://localhost/foo');
    expect(synthesizePreviewUrl('/')).toBe('http://localhost/');
    expect(synthesizePreviewUrl('')).toBe('http://localhost');
  });

  it('preserves the preview port when supplied (Host-derived consumers keep it)', () => {
    expect(synthesizePreviewUrl('/api/messages', 3321)).toBe('http://localhost:3321/api/messages');
  });
});

describe('exported constants', () => {
  it('PREVIEW_LOCAL_HOST is the literal preview.local', () => {
    expect(PREVIEW_LOCAL_HOST).toBe('preview.local');
  });

  it('PREVIEW_PREFIX_RE matches the documented contract', () => {
    expect(PREVIEW_PREFIX_RE.exec('/preview/3000/foo')).not.toBeNull();
    expect(PREVIEW_PREFIX_RE.exec('/preview/3000')).not.toBeNull();
    expect(PREVIEW_PREFIX_RE.exec('/preview/notaport')).toBeNull();
  });
});
