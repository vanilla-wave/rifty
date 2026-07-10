import { describe, expect, it } from 'vitest';
import { withPreviewNoindex } from './preview-noindex';

const PRODUCTION_HEADERS = `/*
  X-Content-Type-Options: nosniff

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

describe('landing preview crawl policy', () => {
  it('adds noindex and nofollow only to the preview copy', () => {
    expect(PRODUCTION_HEADERS).not.toContain('X-Robots-Tag');

    const previewHeaders = withPreviewNoindex(PRODUCTION_HEADERS);
    expect(previewHeaders).toContain('/*\n  X-Robots-Tag: noindex, nofollow\n');
    expect(withPreviewNoindex(previewHeaders)).toBe(previewHeaders);
  });

  it('refuses to mutate an unexpected routing contract', () => {
    expect(() => withPreviewNoindex('/assets/*\n')).toThrow('landing headers must start');
  });
});
