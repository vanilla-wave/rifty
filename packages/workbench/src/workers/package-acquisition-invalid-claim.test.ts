import type { InstallResult } from '@riftydev/npm-client';
import { planShadowSubstitutionsFromLockfile } from '@riftydev/npm-client/internal';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { createInstallStamp, installStampPath, readInstallStamp } from '../glue/install-stamp.ts';
import { discoverPackageAcquisitionGuardTransitions } from '../glue/package-mutation-executor.ts';
import { clearProjectTree } from '../glue/project-deps.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type PackageAcquisitionProject,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';

const ROOT = '/projects/app';
const NESTED_ROOT = `${ROOT}/node_modules/nested`;
const PACKAGE_JSON = '{"name":"app","dependencies":{"vite":"^5.4.0"}}\n';
const NESTED_PACKAGE_JSON = '{"name":"nested"}\n';
const enc = new TextEncoder();

const PROJECT: PackageAcquisitionProject = {
  projectId: 'app',
  root: ROOT,
  slug: 'app',
  identity: installArtifactIdentity,
};
const EMPTY_SHADOW_PLAN = planShadowSubstitutionsFromLockfile({
  lockfileVersion: 3,
  packages: {},
});

const INSTALL_RESULT: InstallResult = {
  packages: [{ name: 'vite', version: '5.4.21', dependencies: {}, files: {} }],
  lockfile: {
    name: 'app',
    version: '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {},
  },
  conflicts: [],
  provenance: {
    resolution: 'metadata',
    packages: [{ name: 'vite', version: '5.4.21', transport: 'registry' }],
  },
};

type InvalidClaimKind = 'malformed' | 'v2' | 'wrong-root';
type ClaimPlacement = 'actual' | 'nested-descendant';
type AcquisitionOperation = 'ensure' | 'terminal' | 'reset';

interface InvalidClaimFixture {
  readonly kind: InvalidClaimKind;
  readonly bytes: (physicalRoot: string) => string;
}

function validStamp(root: string) {
  const stamp = createInstallStamp(root, PACKAGE_JSON, { slug: 'legacy', packages: 1 });
  if (!stamp) throw new Error(`could not construct install stamp for ${root}`);
  return stamp;
}

const INVALID_CLAIMS: readonly InvalidClaimFixture[] = [
  { kind: 'malformed', bytes: () => '{' },
  {
    kind: 'v2',
    bytes: (root) => `${JSON.stringify({ ...validStamp(root), version: 2 })}\n`,
  },
  {
    kind: 'wrong-root',
    bytes: () => `${JSON.stringify(validStamp('/projects/foreign'))}\n`,
  },
];

const PLACEMENTS: readonly ClaimPlacement[] = ['actual', 'nested-descendant'];
const OPERATIONS: readonly AcquisitionOperation[] = ['ensure', 'terminal', 'reset'];
const ACCEPTANCE_CASES = INVALID_CLAIMS.flatMap((claim) =>
  PLACEMENTS.flatMap((placement) =>
    OPERATIONS.map((operation) => ({
      claim: claim.kind,
      claimBytes: claim.bytes,
      placement,
      operation,
    })),
  ),
);

describe('package acquisition invalid physical claim acceptance', () => {
  it.each(ACCEPTANCE_CASES)(
    'clears $claim at $placement before $operation tree mutation',
    async ({ claimBytes, placement, operation }) => {
      const pair = createMemoryFs();
      const claimRoot = placement === 'actual' ? ROOT : NESTED_ROOT;
      pair.fsSync.mkdirSync(`${claimRoot}/node_modules/old`, { recursive: true });
      pair.fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON));
      if (placement === 'nested-descendant') {
        pair.fsSync.writeFileSync(`${NESTED_ROOT}/package.json`, enc.encode(NESTED_PACKAGE_JSON));
      }
      pair.fsSync.writeFileSync(installStampPath(claimRoot), enc.encode(claimBytes(claimRoot)));

      const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(
        pair.fsSync,
        { ownerEpoch: `${operation}-${placement}` },
      );
      const stamps = createInstallStampAuthority({
        vfs: pair.vfs,
        fsSync: owner,
        claimIo: installStampClaims,
      });
      const mutations: string[] = [];
      const installTree = (): void => {
        mutations.push(operation);
        clearProjectTree(owner, ROOT);
        owner.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON));
        owner.mkdirSync(`${ROOT}/node_modules/vite`, { recursive: true });
        owner.writeFileSync(`${ROOT}/node_modules/vite/package.json`, enc.encode('{}\n'));
      };
      const authority = createPackageAcquisitionAuthority({
        stamps,
        resolveTreeGuards: (root, knownProjects) =>
          discoverPackageAcquisitionGuardTransitions(owner, knownProjects, root),
        adapter: {
          planSnapshotRestore: async () => ({
            status: 'ready',
            packages: 1,
            shadowPlan: EMPTY_SHADOW_PLAN,
            apply: async () => installTree(),
          }),
          install: async () => {
            installTree();
            return {
              result: INSTALL_RESULT,
              shadowPlan: EMPTY_SHADOW_PLAN,
              packageJsonText: PACKAGE_JSON,
            };
          },
          reset: async () => {
            mutations.push(operation);
            clearProjectTree(owner, ROOT);
          },
          switchProject: async () => {},
        },
      });

      expect(() => clearProjectTree(owner, ROOT)).toThrowError(
        /reserved install-stamp authority claim path/,
      );
      expect(owner.existsSync(installStampPath(claimRoot))).toBe(true);

      if (operation === 'ensure') {
        await expect(
          authority.dispatch({
            type: 'ensure',
            project: PROJECT,
            packageJsonText: PACKAGE_JSON,
            snapshot: {
              snapshotId: 'acceptance-snapshot',
              identity: installArtifactIdentity,
              packageJsonText: PACKAGE_JSON,
            },
          }),
        ).resolves.toMatchObject({ outcome: 'snapshot' });
      } else if (operation === 'terminal') {
        await expect(
          authority.dispatch({ type: 'terminal-install', project: PROJECT, argv: [] }),
        ).resolves.toMatchObject({ outcome: 'installed' });
      } else {
        await expect(
          authority.dispatch({ type: 'reset', target: { root: ROOT } }),
        ).resolves.toBeUndefined();
      }

      expect(mutations).toEqual([operation]);
      expect(owner.existsSync(installStampPath(NESTED_ROOT))).toBe(false);
      if (operation === 'reset') {
        expect(owner.existsSync(`${ROOT}/node_modules`)).toBe(false);
        await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toEqual({
          status: 'absent',
        });
      } else {
        expect(owner.existsSync(`${ROOT}/node_modules/vite/package.json`)).toBe(true);
        await expect(readInstallStamp(pair.vfs, ROOT)).resolves.toMatchObject({
          version: 4,
          root: ROOT,
          slug: PROJECT.slug,
          installArtifactIdentity,
        });
        await expect(stamps.check({ root: ROOT, slug: PROJECT.slug })).resolves.toMatchObject({
          status: 'trusted',
        });
      }
    },
  );
});
