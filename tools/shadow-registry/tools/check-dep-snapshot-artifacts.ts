import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import identityFile from '../../../apps/playground/src/generated/install-artifact-identity.json';
import { serializeDepSnapshot } from '../../../apps/playground/src/glue/dep-snapshot.ts';
import { effectiveDepsFromPackageJsonText } from '../../../apps/playground/src/glue/install-stamp.ts';
import { buildProjectPackageJson } from '../../../apps/playground/src/templates/project-spec.ts';
import { allProjectSpecs } from '../../../apps/playground/src/templates/registry.ts';
import { applyViteCliActionPatch } from '../../../apps/playground/src/workers/vite-cli-install-policy.ts';
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
      validateInstallFiles: proveViteCliPatchInput,
    });
  }
  console.log('snapshot artifacts: current');
}

const decoder = new TextDecoder();
function proveViteCliPatchInput(files: ReadonlyMap<string, Uint8Array>): void {
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
