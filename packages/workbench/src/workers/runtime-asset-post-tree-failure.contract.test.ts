import {
  type InstallOptions,
  type InstallResult,
  RegistryClient,
  ShadowAssetInstallError,
  planBuiltinShadowAssets,
} from '@riftydev/npm-client';
import {
  builtinShadowAssetCatalog,
  builtinSyntheticPackageRecipes,
} from '@riftydev/shadow-registry';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { executeNpmInstallOperation, parseNpmInstallRequest } from '../glue/npm-shell-command.ts';

const ROOT = '/project';
const ORIGINAL_PACKAGE_JSON = '{"name":"app","version":"1.0.0"}\n';
const LOCKFILE = '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n';

function shadowPlan() {
  return planBuiltinShadowAssets([
    {
      catalog: {
        id: builtinShadowAssetCatalog.id,
        digest: builtinShadowAssetCatalog.digest,
      },
      publicName: 'esbuild',
      requestedRange: '^0.28.0',
      resolvedPublicVersion: '0.28.0',
      substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
      runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
      builtin: true,
    },
  ]);
}

function treeResult(): InstallResult {
  return {
    packages: [
      {
        name: 'kleur',
        version: '4.1.5',
        dependencies: {},
        files: {},
      },
    ],
    lockfile: {
      name: 'app',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        'node_modules/esbuild': {
          version: '0.28.0',
          dependencies: {},
          rifty: {
            materialization: {
              protocol: 'rifty.lockfile-package-materialization/v1',
              kind: 'synthesized-shadow-delegate',
              substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
              recipeSha256: builtinSyntheticPackageRecipes[0]!.recipeSha256,
            },
          },
        },
      },
      rifty: {
        shadowSubstitutions: {
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
        },
      },
    },
    conflicts: [],
    provenance: {
      resolution: 'metadata',
      packages: [{ name: 'kleur', version: '4.1.5', transport: 'registry' }],
    },
  };
}

async function project(): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir(ROOT, { recursive: true });
  await vfs.writeFile(`${ROOT}/package.json`, ORIGINAL_PACKAGE_JSON);
  return vfs;
}

function request() {
  const parsed = parseNpmInstallRequest(['kleur@4.1.5']);
  if (parsed.status === 'rejected') throw new Error(parsed.message);
  return parsed.request;
}

function sink() {
  return { write: (_chunk: string | Uint8Array): void => {} };
}

describe('nominal post-tree runtime-asset install failure', () => {
  it('returns the exact post-tree outcome without rolling back the requested manifest', async () => {
    const vfs = await project();
    const plan = shadowPlan();
    const installed = treeResult();
    const assetError = new ShadowAssetInstallError(installed, plan, {
      message: 'verified object could not be persisted',
      requiredSetDigest: plan.requiredSetDigest,
      assetId: plan.assets[0]!.id,
      phase: 'persist',
      transports: [{ transport: 'standard', message: 'quota exhausted' }],
      recovery: 'clear-and-retry',
    });

    const outcome = (await executeNpmInstallOperation(
      request(),
      { cwd: ROOT, env: {}, stdout: sink(), stderr: sink() },
      {
        vfs,
        registry: new RegistryClient({
          baseUrl: '/unused',
          fetch: async () => new Response(null, { status: 599 }),
        }),
        install: async (input) => {
          const options = input as InstallOptions;
          await options.vfs.mkdir(`${ROOT}/node_modules/kleur`, { recursive: true });
          await options.vfs.writeFile(`${ROOT}/node_modules/kleur/index.js`, 'installed\n');
          await options.vfs.writeFile(`${ROOT}/package-lock.json`, LOCKFILE);
          throw assetError;
        },
      },
      { sessionInstallActivity: false, priorTrustedTree: false },
    )) as unknown as Readonly<{
      status: 'post-tree-failure';
      treeResult: InstallResult;
      packageJsonText: string;
      error: ShadowAssetInstallError;
    }>;

    expect(outcome).toEqual({
      status: 'post-tree-failure',
      treeResult: installed,
      packageJsonText: '{"name":"app","version":"1.0.0","dependencies":{"kleur":"4.1.5"}}\n',
      error: assetError,
    });
    await expect(vfs.readFileText(`${ROOT}/package.json`)).resolves.toBe(outcome.packageJsonText);
    await expect(vfs.readFileText(`${ROOT}/package-lock.json`)).resolves.toBe(LOCKFILE);
    await expect(vfs.readFileText(`${ROOT}/node_modules/kleur/index.js`)).resolves.toBe(
      'installed\n',
    );
  });

  it('does not recognize name/code duck typing as an attested post-tree outcome', async () => {
    const vfs = await project();
    const plan = shadowPlan();
    const installed = treeResult();
    const forged = Object.freeze({
      name: 'ShadowAssetInstallError',
      code: 'ESHADOWASSET',
      treeResult: installed,
      plan,
    });

    await expect(
      executeNpmInstallOperation(
        request(),
        { cwd: ROOT, env: {}, stdout: sink(), stderr: sink() },
        {
          vfs,
          registry: new RegistryClient({
            baseUrl: '/unused',
            fetch: async () => new Response(null, { status: 599 }),
          }),
          install: async () => {
            throw forged;
          },
        },
        { sessionInstallActivity: false, priorTrustedTree: false },
      ),
    ).rejects.toBe(forged);
    await expect(vfs.readFileText(`${ROOT}/package.json`)).resolves.toBe(ORIGINAL_PACKAGE_JSON);
  });
});
