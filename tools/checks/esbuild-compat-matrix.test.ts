import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const matrixUrl = new URL('../../docs/public/compat/esbuild-js-api.md', import.meta.url);
const policyUrl = new URL('../shadow-registry/esbuild-runtime-policy.json', import.meta.url);

describe('esbuild compatibility gap statuses', () => {
  it('marks every unsupported D4 API as not implemented', async () => {
    const matrix = await readFile(matrixUrl, 'utf8');
    const policy = JSON.parse(await readFile(policyUrl, 'utf8')) as {
      readonly gaps: readonly { readonly surface: string }[];
    };
    const gapStatuses = new Map(
      [...matrix.matchAll(/^\| D4 gap: `([^`]+)` \| ([^|]+) \|/gmu)].map(([, surface, status]) => [
        surface,
        status?.trim(),
      ]),
    );

    expect(gapStatuses).toEqual(
      new Map(policy.gaps.map(({ surface }) => [surface, '❌'] as const)),
    );
  });
});
