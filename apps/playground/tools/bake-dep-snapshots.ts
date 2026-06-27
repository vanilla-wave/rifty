/**
 * Bake dependency snapshots (ADR-0135): for every template that declares
 * `bakedNodeModulesUrl`, run a real `install()` into a memory VFS and write
 * the resulting node_modules + lockfile as a gzipped JSON asset under
 * `public/snapshots/`. Run via `pnpm snapshots:bake` after changing a baked
 * template's dependency maps; the asset is committed (deploys stay hermetic).
 *
 * Same installer, same shadow overrides, same native-dep gate as the worker —
 * the baked tree is byte-equivalent to what a worker-side install produces
 * (minus the esbuild/rollup shim overlay, which the worker applies at boot).
 */
// TODO(backlog: playground/baked-snapshot-regeneration)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { RegistryClient, install } from '@riftydev/npm-client';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { buildDepSnapshot } from '../src/glue/dep-snapshot.ts';
import { readEffectiveDeps } from '../src/glue/install-stamp.ts';
import { buildProjectPackageJson } from '../src/templates/project-spec.ts';
import { allProjectSpecs } from '../src/templates/registry.ts';
import { assertRollupWasmNodeLockstep } from '../src/templates/rollup-lockstep.ts';

const ROOT = '/workspace';
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../public');
// D-004: env-overridable; npmjs is the canonical default for this build tool
// (the in-browser proxy route is meaningless in Node).
const registryBaseUrl = process.env.REGISTRY_BASE_URL ?? 'https://registry.npmjs.org';

const baked = allProjectSpecs().filter((spec) => spec.bakedNodeModulesUrl);
if (baked.length === 0) {
  console.log('no templates declare bakedNodeModulesUrl — nothing to bake');
}

for (const spec of baked) {
  const url = spec.bakedNodeModulesUrl;
  if (!url) continue;
  const requestedDeps = { ...spec.install, ...(spec.devDependencies ?? {}) };
  console.log(`baking ${spec.id} (${JSON.stringify(requestedDeps)}) from ${registryBaseUrl}…`);

  const { vfs, fsSync } = createMemoryFs();
  await vfs.mkdir(ROOT, { recursive: true });
  await vfs.writeFile(`${ROOT}/package.json`, buildProjectPackageJson(spec).json);

  const registry = new RegistryClient({
    baseUrl: registryBaseUrl,
    fetch: (input, init) => fetch(input, init),
  });
  const result = await install({ vfs, cwd: ROOT, registry });
  assertRollupWasmNodeLockstep(spec.id, result.lockfile);

  const deps = await readEffectiveDeps(vfs, ROOT);
  if (!deps) throw new Error(`bake(${spec.id}): package.json unreadable after install`);
  const snapshot = buildDepSnapshot(fsSync, ROOT, {
    templateId: spec.id,
    deps,
    packages: result.packages.length,
  });

  const json = JSON.stringify(snapshot);
  const gz = gzipSync(Buffer.from(json), { level: 9 });
  const outPath = join(publicDir, ...url.replace(/^\/+/, '').split('/'));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, gz);
  console.log(
    `  ${spec.id}: ${result.packages.length} packages, ${(json.length / 1e6).toFixed(1)} MB json → ${(gz.length / 1e6).toFixed(1)} MB gz → ${outPath}`,
  );
}
