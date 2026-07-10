import { describe, expect, it } from 'vitest';
import { requireSiteBaseUrl } from './configured-url';

describe('landing site URL', () => {
  it('rejects an unserved subpath instead of advertising false crawl URLs', () => {
    expect(() => requireSiteBaseUrl('https://site.example.test/base/')).toThrow(
      'VITE_RIFTY_SITE_URL must use the origin root',
    );
  });
});
