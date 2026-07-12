import { describe, expect, it } from 'vitest';
import { assertNoUserViteConfig } from './vite-config-guard.ts';

describe('assertNoUserViteConfig', () => {
  it('keeps the legacy curated path loud', () => {
    expect(() =>
      assertNoUserViteConfig('/scratch', (path) => path === '/scratch/vite.config.ts'),
    ).toThrow(
      expect.objectContaining({ name: 'NotImplementedError', feature: 'vite.config-loading' }),
    );
  });
});
