import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProjectPackageJson } from '../../../apps/playground/src/templates/project-spec.ts';
import { allProjectSpecs } from '../../../apps/playground/src/templates/registry.ts';
import identityFile from '../../../packages/workbench/src/generated/install-artifact-identity.json';
import { serializeDepSnapshot } from '../../../packages/workbench/src/glue/dep-snapshot.ts';
import { effectiveDepsFromPackageJsonText } from '../../../packages/workbench/src/glue/install-stamp.ts';
import {
  applyViteCliActionPatch,
  applyViteRootWatchPatch,
  viteRootWatchPatchPolicy,
} from '../../../packages/workbench/src/workers/vite-cli-install-policy.ts';
import {
  applyViteConfigTempPatch,
  viteConfigTempPatchPolicy,
} from '../../../packages/workbench/src/workers/vite-config-temp-patch.ts';
import { internalsShims } from '../src/index.ts';
import { assertSnapshotArtifactCurrent } from '../src/snapshot-artifact-check.ts';

const publicDir = fileURLToPath(new URL('../../../apps/playground/public/', import.meta.url));
const identity = identityFile.identity;
if (!/^sha256:[a-f0-9]{64}$/.test(identity)) {
  throw new Error('generated install artifact identity is malformed');
}

async function main(): Promise<void> {
  for (const spec of allProjectSpecs()) {
    if (!spec.bakedNodeModulesUrl) continue;
    const path = join(publicDir, ...spec.bakedNodeModulesUrl.replace(/^\/+/, '').split('/'));
    const packageJsonText = buildProjectPackageJson(spec).json;
    const deps = effectiveDepsFromPackageJsonText(packageJsonText);
    if (!deps) throw new Error(`${spec.id}: current packageJsonText has no effective deps`);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch {
      throw new Error(`${spec.id}: snapshot is unreadable; run a full \`pnpm snapshots:bake\``);
    }
    assertSnapshotArtifactCurrent({
      bytes,
      snapshotId: spec.bakedNodeModulesSnapshotId,
      label: spec.id,
      templateId: spec.id,
      packageJsonText,
      installArtifactIdentity: identity,
      deps,
      shims: internalsShims,
      canonicalize: serializeDepSnapshot,
      validateInstallFiles: proveViteInstallPatchInput,
    });
  }
  console.log('snapshot artifacts: current');
}

const decoder = new TextDecoder();
export function proveViteInstallPatchInput(files: ReadonlyMap<string, Uint8Array>): void {
  const cliPaths = [...files.keys()].filter(
    (path) =>
      path === 'vite/dist/node/cli.js' || path.endsWith('/node_modules/vite/dist/node/cli.js'),
  );
  if (cliPaths.length === 0) throw new Error('snapshot contains no Vite CLI transform input');
  for (const path of cliPaths) {
    try {
      applyViteCliActionPatch(decoder.decode(files.get(path)));
    } catch (error) {
      throw new Error(`${path} is not patchable by the current Vite CLI transform`, {
        cause: error,
      });
    }
  }
  const chunkPaths = [...files.keys()].filter(
    (path) =>
      (path.startsWith('vite/dist/node/chunks/') ||
        path.includes('/node_modules/vite/dist/node/chunks/')) &&
      path.endsWith('.js'),
  );
  const candidates = chunkPaths.filter((path) => {
    const source = decoder.decode(files.get(path));
    return (
      source.includes(viteRootWatchPatchPolicy.needle) ||
      source.includes(viteRootWatchPatchPolicy.replacement)
    );
  });
  if (candidates.length !== 1) {
    throw new Error(
      `snapshot must contain one Vite root watcher input; found ${candidates.length}`,
    );
  }
  for (const path of candidates) {
    try {
      applyViteRootWatchPatch(decoder.decode(files.get(path)));
    } catch (error) {
      throw new Error(`${path} is not patchable by the current Vite root watcher transform`, {
        cause: error,
      });
    }
  }
  const manifestPaths = [...files.keys()].filter(
    (path) => path === 'vite/package.json' || path.endsWith('/node_modules/vite/package.json'),
  );
  if (manifestPaths.length === 0) throw new Error('snapshot contains no Vite manifest');
  for (const manifestPath of manifestPaths) {
    let manifest: { readonly name?: unknown; readonly version?: unknown };
    try {
      manifest = JSON.parse(decoder.decode(files.get(manifestPath))) as {
        readonly name?: unknown;
        readonly version?: unknown;
      };
    } catch (error) {
      throw new Error(`${manifestPath} is not a valid Vite manifest`, { cause: error });
    }
    if (manifest.name !== 'vite' || typeof manifest.version !== 'string') {
      throw new Error(`${manifestPath} is not an exact Vite manifest`);
    }
    const policy = viteConfigTempPatchPolicy.sources.find(
      (candidate) => candidate.version === manifest.version,
    );
    if (!policy) {
      throw new Error(`${manifestPath} has unsupported Vite version ${manifest.version}`);
    }
    const packageRoot = manifestPath.slice(0, -'/package.json'.length);
    const expectedPath = `${packageRoot}/${policy.relativeSourcePath}`;
    const packageChunks = chunkPaths.filter((path) =>
      path.startsWith(`${packageRoot}/dist/node/chunks/`),
    );
    let anchors = 0;
    for (const path of packageChunks) {
      const source = decoder.decode(files.get(path));
      for (const candidate of viteConfigTempPatchPolicy.sources) {
        anchors += source.split(candidate.upstreamBlock).length - 1;
        anchors += source.split(candidate.preparedBlock).length - 1;
      }
    }
    if (anchors !== 1 || !files.has(expectedPath)) {
      throw new Error(
        `${manifestPath} must select one Vite config-temp input at ${expectedPath}; found ${anchors}`,
      );
    }
    try {
      applyViteConfigTempPatch(decoder.decode(files.get(expectedPath)), manifest.version);
    } catch (error) {
      throw new Error(
        `${expectedPath} is not patchable by the current Vite config-temp transform`,
        {
          cause: error,
        },
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
