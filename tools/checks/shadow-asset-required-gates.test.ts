import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const rootPackageUrl = new URL('../../package.json', import.meta.url);
const prCheckUrl = new URL('./pr-check.mjs', import.meta.url);

describe('shadow asset finite acceptance gates', () => {
  it('makes live catalog drift and real manager materialization mandatory in pr:check', async () => {
    const rootPackage = JSON.parse(await readFile(rootPackageUrl, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const prCheck = await readFile(prCheckUrl, 'utf8');

    expect(rootPackage.scripts?.['check:shadow-asset-catalog-drift']).toBe(
      'pnpm --filter @riftydev/shadow-registry shadow-assets:check',
    );
    expect(rootPackage.scripts?.['check:shadow-asset-real-acceptance']).toBe(
      'tsx tools/checks/shadow-asset-real-acceptance.ts',
    );
    expect(prCheck).toContain("'check:shadow-asset-catalog-drift'");
    expect(prCheck).toContain("'check:shadow-asset-real-acceptance'");
  });
});
