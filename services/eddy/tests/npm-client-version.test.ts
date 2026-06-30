import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readNpmClientVersion } from '../src/npm-client-version.ts';

describe('readNpmClientVersion', () => {
  it('reports the actual @riftydev/npm-client package version (skew audit)', () => {
    // Independent read of the source of truth.
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '../../../packages/npm-client/package.json');
    const expected = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
    expect(readNpmClientVersion()).toBe(expected);
  });
});
