import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { installArtifactTreePolicy } from './install-artifact-recipe.ts';

const policy = JSON.parse(
  readFileSync(new URL('../esbuild-runtime-policy.json', import.meta.url), 'utf8'),
) as Readonly<Record<string, unknown>>;

describe('install artifact recipe fault closure', () => {
  it.each([
    [
      'top-level',
      { ...policy, generatedRuntimePrefix: 'tree-affecting bytes' },
      'generatedRuntimePrefix',
    ],
    [
      'source',
      {
        ...policy,
        source: {
          ...(policy.source as Readonly<Record<string, unknown>>),
          generatedRuntimePrefix: 'tree-affecting bytes',
        },
      },
      'generatedRuntimePrefix',
    ],
  ])('loud-throws an unclassified %s policy field', (_scope, candidate, field) => {
    expect(() => installArtifactTreePolicy(candidate)).toThrow(field);
  });
});
