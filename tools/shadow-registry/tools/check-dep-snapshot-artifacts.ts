import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProjectPackageJson } from '../../../apps/playground/src/templates/project-spec.ts';
import { allProjectSpecs } from '../../../apps/playground/src/templates/registry.ts';
import identityFile from '../../../packages/workbench/src/generated/install-artifact-identity.json';
import {
  serializeDepSnapshot,
  verifyDepSnapshotReplayCache,
} from '../../../packages/workbench/src/glue/dep-snapshot.ts';
import { effectiveDepsFromPackageJsonText } from '../../../packages/workbench/src/glue/install-stamp.ts';
import {
  inspectProjectDefinition,
  projects,
} from '../../../packages/workbench/src/workbench/project-definition.ts';
import {
  type EmnapiCorePatchFormat,
  applyEmnapiCoreOrphanedReferencePatch,
  emnapiCoreOrphanedReferencePatchPolicy,
} from '../../../packages/workbench/src/workers/emnapi-core-install-policy.ts';
import {
  applyViteCliActionPatch,
  applyViteRootWatchPatch,
  viteRootWatchPatchPolicy,
} from '../../../packages/workbench/src/workers/vite-cli-install-policy.ts';
import { internalsShims } from '../src/index.ts';
import { assertSnapshotArtifactCurrent } from '../src/snapshot-artifact-check.ts';

const publicDir = fileURLToPath(new URL('../../../apps/playground/public/', import.meta.url));
const identity = identityFile.identity;
if (!/^sha256:[a-f0-9]{64}$/.test(identity)) {
  throw new Error('generated install artifact identity is malformed');
}
const packageDecoder = new TextDecoder('utf-8', { fatal: true });

function finalProjectPackageJson(spec: ReturnType<typeof allProjectSpecs>[number]): string {
  const packageJson = buildProjectPackageJson(spec).json;
  if (spec.runtime !== 'vite') return packageJson;
  const definition = inspectProjectDefinition(
    projects.vite({
      id: `snapshot-check:${spec.id}`,
      files: { '/package.json': packageJson },
    }),
  );
  const bytes = definition.files['/package.json'];
  if (bytes === undefined) {
    throw new Error(`${spec.id}: Workbench omitted normalized package.json`);
  }
  return packageDecoder.decode(bytes);
}

async function main(): Promise<void> {
  for (const spec of allProjectSpecs()) {
    if (!spec.bakedNodeModulesUrl) continue;
    const path = join(publicDir, ...spec.bakedNodeModulesUrl.replace(/^\/+/, '').split('/'));
    const packageJsonText = finalProjectPackageJson(spec);
    const deps = effectiveDepsFromPackageJsonText(packageJsonText);
    if (!deps) throw new Error(`${spec.id}: current packageJsonText has no effective deps`);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch {
      throw new Error(`${spec.id}: snapshot is unreadable; run a full \`pnpm snapshots:bake\``);
    }
    const snapshot = assertSnapshotArtifactCurrent({
      bytes,
      snapshotId: spec.bakedNodeModulesSnapshotId,
      label: spec.id,
      templateId: spec.id,
      packageJsonText,
      installArtifactIdentity: identity,
      deps,
      shims: internalsShims,
      canonicalize: serializeDepSnapshot,
      validateInstallFiles: proveViteCliPatchInput,
    });
    try {
      await verifyDepSnapshotReplayCache(snapshot);
    } catch (error) {
      throw new Error(
        `${spec.id}: ${error instanceof Error ? error.message : String(error)}; run a full \`pnpm snapshots:bake\``,
        { cause: error },
      );
    }
  }
  console.log('snapshot artifacts: current');
}

const decoder = new TextDecoder();
function proveViteCliPatchInput(files: ReadonlyMap<string, Uint8Array>): void {
  proveEmnapiCorePatchInput(files);
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
}

function proveEmnapiCorePatchInput(files: ReadonlyMap<string, Uint8Array>): void {
  const manifests = [...files.keys()].filter((path) => path.endsWith('@emnapi/core/package.json'));
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(decoder.decode(files.get(manifestPath))) as {
      readonly version?: unknown;
    };
    if (manifest.version !== emnapiCoreOrphanedReferencePatchPolicy.version) continue;
    const packageRoot = manifestPath.slice(0, -'/package.json'.length);
    const inputs = [
      [`${packageRoot}/dist/emnapi-core.cjs.js`, 'readable'],
      [`${packageRoot}/dist/emnapi-core.cjs.min.js`, 'minified'],
    ] as const satisfies readonly (readonly [string, EmnapiCorePatchFormat])[];
    for (const [path, format] of inputs) {
      const bytes = files.get(path);
      if (bytes === undefined) throw new Error(`${path} is missing from the snapshot`);
      try {
        applyEmnapiCoreOrphanedReferencePatch(decoder.decode(bytes), format);
      } catch (error) {
        throw new Error(`${path} is not patchable by the current @emnapi/core transform`, {
          cause: error,
        });
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
