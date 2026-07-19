import * as shadowRegistry from '@riftydev/shadow-registry';
import { describe, expect, it } from 'vitest';
import { bundleCompletenessGap } from './installer-lockfile-reader.ts';
import type { Lockfile } from './linker.ts';

function recipeSha256(): string {
  const recipes = (
    shadowRegistry as typeof shadowRegistry & {
      readonly builtinSyntheticPackageRecipes?: readonly { readonly recipeSha256: string }[];
    }
  ).builtinSyntheticPackageRecipes;
  if (!recipes?.[0]) throw new Error('Contract+RED: builtin synthetic recipe is absent');
  return recipes[0].recipeSha256;
}

function marker(): Record<string, unknown> {
  return {
    protocol: 'rifty.lockfile-package-materialization/v1',
    kind: 'synthesized-shadow-delegate',
    substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
    recipeSha256: recipeSha256(),
  };
}

function trace() {
  return {
    protocol: 'rifty.lockfile-shadow-substitutions/v1',
    applied: [
      {
        publicName: 'esbuild',
        requestedRange: '^0.28.0',
        resolvedPublicVersion: '0.28.0',
        runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
        substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
      },
    ],
  } as const;
}

function syntheticOnlyLockfile(): Lockfile {
  return {
    name: 'root',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { version: '1.0.0', dependencies: { esbuild: '0.28.0' } },
      'node_modules/esbuild': {
        version: '0.28.0',
        dependencies: {},
        rifty: { materialization: marker() },
      } as never,
    },
    rifty: { shadowSubstitutions: trace() },
  };
}

describe('Eddy completeness — materialization-aware closure', () => {
  it('requires no tarball only for the exact active synthesized marker', () => {
    expect(bundleCompletenessGap(syntheticOnlyLockfile(), { esbuild: '^0.28.0' }, [])).toBeNull();
  });

  it.each([
    [
      'missing marker',
      (entry: Record<string, unknown>) => {
        Reflect.deleteProperty(entry, 'rifty');
      },
    ],
    [
      'drifted recipe digest',
      (entry: Record<string, unknown>) => {
        const value = entry.rifty as { materialization: Record<string, unknown> };
        value.materialization.recipeSha256 = '0'.repeat(64);
      },
    ],
    [
      'unsupported protocol',
      (entry: Record<string, unknown>) => {
        const value = entry.rifty as { materialization: Record<string, unknown> };
        value.materialization.protocol = 'rifty.lockfile-package-materialization/v999';
      },
    ],
  ] as const)('%s cannot hide a missing tarball', (_label, mutate) => {
    const lockfile = syntheticOnlyLockfile();
    mutate(lockfile.packages['node_modules/esbuild'] as unknown as Record<string, unknown>);
    const outcome = bundleCompletenessGap(lockfile, { esbuild: '^0.28.0' }, []);
    expect(outcome).toMatch(/materialization|recipe|protocol|tarball|replay fields/i);
  });

  it('requires a tarball only for the ordinary same-coordinate placement in a mixed tree', () => {
    const lockfile = syntheticOnlyLockfile();
    const rootEntry = lockfile.packages[''];
    if (!rootEntry) throw new Error('setup: lockfile root entry absent');
    rootEntry.dependencies = { esbuild: '0.28.0', parent: '1.0.0' };
    lockfile.packages['node_modules/parent'] = {
      version: '1.0.0',
      resolved: 'fixture://parent|1.0.0',
      integrity: 'sha512-parent',
      dependencies: { esbuild: '0.28.0' },
    };
    lockfile.packages['node_modules/parent/node_modules/esbuild'] = {
      version: '0.28.0',
      resolved: 'fixture://esbuild|0.28.0',
      integrity: 'sha512-public-esbuild',
      dependencies: {},
    };

    expect(
      bundleCompletenessGap(lockfile, { esbuild: '^0.28.0', parent: '1.0.0' }, [
        { name: 'parent', version: '1.0.0', integrity: 'sha512-parent' },
        { name: 'esbuild', version: '0.28.0', integrity: 'sha512-public-esbuild' },
      ]),
    ).toBeNull();
  });
});
