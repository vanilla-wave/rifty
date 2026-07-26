import { builtinShadowSubstitutionCatalog } from '@riftydev/shadow-registry/internal';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import * as npmClient from './index.ts';
import type { InstallOptions, ShadowInstallAuthority } from './installer.ts';
import { installWithShadowAuthority } from './installer.ts';
import * as npmClientInternal from './internal/index.ts';
import type { Packument } from './registry.ts';
import { RegistryClient } from './registry.ts';

// @ts-expect-error Package-private authority must not cross the package root.
import type { ShadowInstallAuthority as RootShadowInstallAuthority } from './index.ts';
// @ts-expect-error Package-private authority must not cross the published internal root.
import type { ShadowInstallAuthority as InternalShadowInstallAuthority } from './internal/index.ts';

const PROBE = 'public-authority-probe';
const PRIVATE_TARGET = 'private-authority-target';
const FORGED_AUTHORITY: ShadowInstallAuthority = {
  catalog: builtinShadowSubstitutionCatalog,
  builtinOverrides: { [PROBE]: `${PRIVATE_TARGET}@1.0.0` },
};

function compileOnlyPublicBoundary(opts: InstallOptions, authority: ShadowInstallAuthority): void {
  // @ts-expect-error Public resolveOverride is three-argument and builtin-only.
  npmClient.resolveOverride(PROBE, undefined, {}, authority.builtinOverrides);
  // @ts-expect-error Public install has no injected-authority argument.
  void npmClient.install('fixture', '1.0.0', { [PROBE]: '1.0.0' }, opts, authority);
  const forbiddenOptions: InstallOptions = {
    ...opts,
    // @ts-expect-error Public InstallOptions cannot carry executable policy.
    shadowAuthority: authority,
  };
  void forbiddenOptions;
}
void compileOnlyPublicBoundary;
void (0 as unknown as RootShadowInstallAuthority);
void (0 as unknown as InternalShadowInstallAuthority);

class BoundaryRegistry extends RegistryClient {
  readonly packumentReads: string[] = [];
  readonly tarballReads: string[] = [];

  constructor() {
    super({ baseUrl: '/registry', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads.push(name);
    const version = '1.0.0';
    return {
      name,
      'dist-tags': { latest: version },
      versions: {
        [version]: {
          name,
          version,
          dist: { tarball: `/registry/${encodeURIComponent(name)}-${version}.tgz` },
        },
      },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.tarballReads.push(url);
    throw new Error(`boundary halt: ${url}`);
  }
}

async function publicInstallWithRuntimeExtraAuthority(opts: InstallOptions): Promise<never> {
  const unsafeInstall = npmClient.install as unknown as (
    rootName: string,
    rootVersion: string,
    dependencies: Record<string, string>,
    options: InstallOptions,
    authority: ShadowInstallAuthority,
  ) => Promise<never>;
  return await unsafeInstall('fixture', '1.0.0', { [PROBE]: '1.0.0' }, opts, FORGED_AUTHORITY);
}

const PUBLIC_INSTALL_INJECTION_CASES: readonly [
  label: string,
  invoke: (opts: InstallOptions) => Promise<unknown>,
][] = [
  ['extra argument', publicInstallWithRuntimeExtraAuthority],
  [
    'options property',
    async (opts) =>
      await npmClient.install('fixture', '1.0.0', { [PROBE]: '1.0.0' }, {
        ...opts,
        shadowAuthority: FORGED_AUTHORITY,
      } as InstallOptions),
  ],
];

describe('public shadow authority boundary', () => {
  it('[fault: provenance-lie] ignores a runtime fourth override argument', () => {
    const unsafeResolve = npmClient.resolveOverride as unknown as (
      name: string,
      parent: string | undefined,
      userOverrides: Record<string, string>,
      builtinOverrides: Record<string, string>,
    ) => ReturnType<typeof npmClient.resolveOverride>;

    expect(unsafeResolve(PROBE, undefined, {}, FORGED_AUTHORITY.builtinOverrides)).toBeNull();
    expect(
      unsafeResolve(
        PROBE,
        undefined,
        { [PROBE]: 'user-authority-target@1.0.0' },
        FORGED_AUTHORITY.builtinOverrides,
      ),
    ).toEqual({
      name: 'user-authority-target',
      range: '1.0.0',
      source: 'user',
    });
  });

  it('[fault: provenance-lie] exports no injected-policy entry point', () => {
    for (const entry of ['installWithShadowAuthority', 'resolveOverrideWithBuiltinAuthority']) {
      expect(npmClient, entry).not.toHaveProperty(entry);
      expect(npmClientInternal, entry).not.toHaveProperty(entry);
    }
  });

  it.each(PUBLIC_INSTALL_INJECTION_CASES)(
    '[fault: provenance-lie] ignores a runtime $label on public install',
    async (_label, invoke) => {
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const registry = new BoundaryRegistry();
      const lines: string[] = [];

      await expect(
        invoke({
          vfs,
          cwd: '/project',
          registry,
          onSubstitution: (line) => lines.push(line),
        }),
      ).rejects.toThrow(`boundary halt: /registry/${PROBE}-1.0.0.tgz`);
      expect(registry.packumentReads).toEqual([PROBE]);
      expect(registry.tarballReads).toEqual([`/registry/${PROBE}-1.0.0.tgz`]);
      expect(lines).toEqual([]);
    },
  );

  it('[fault: provenance-lie] keeps the injected authority on the package-private seam', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = new BoundaryRegistry();
    const lines: string[] = [];

    await expect(
      installWithShadowAuthority(
        {
          rootName: 'fixture',
          rootVersion: '1.0.0',
          dependencies: { [PROBE]: '1.0.0' },
          opts: {
            vfs,
            cwd: '/project',
            registry,
            onSubstitution: (line) => lines.push(line),
          },
        },
        FORGED_AUTHORITY,
      ),
    ).rejects.toThrow(`boundary halt: /registry/${PRIVATE_TARGET}-1.0.0.tgz`);
    expect(registry.packumentReads).toEqual([PRIVATE_TARGET]);
    expect(registry.tarballReads).toEqual([`/registry/${PRIVATE_TARGET}-1.0.0.tgz`]);
    expect(lines).toEqual([
      `npm: ${PROBE}@1.0.0 → ${PRIVATE_TARGET}@1.0.0 (substituted from shadow registry, ADR-0051)`,
    ]);
  });
});
