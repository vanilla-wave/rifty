import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const rootPackageUrl = new URL('../../package.json', import.meta.url);
const prCheckUrl = new URL('./pr-check.mjs', import.meta.url);

describe('publish configuration drift gate', () => {
  it('makes generated package and tsup configuration drift mandatory in pr:check', async () => {
    const rootPackage = JSON.parse(await readFile(rootPackageUrl, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const prCheck = await readFile(prCheckUrl, 'utf8');

    expect(rootPackage.scripts?.['check:publish-config-drift']).toBe(
      'node tools/publishing/sync-publish-config.mjs --check',
    );
    expect(prCheck).toContain("'check:publish-config-drift'");
  });
});
