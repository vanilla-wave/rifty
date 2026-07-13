import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import identityFile from '../../../apps/playground/src/generated/install-artifact-identity.json';
import {
  type DepSnapshotV2,
  serializeDepSnapshot,
} from '../../../apps/playground/src/glue/dep-snapshot.ts';
import { effectiveDepsFromPackageJsonText } from '../../../apps/playground/src/glue/install-stamp.ts';
import { buildProjectPackageJson } from '../../../apps/playground/src/templates/project-spec.ts';
import { allProjectSpecs } from '../../../apps/playground/src/templates/registry.ts';
import { internalsShims } from '../src/index.ts';

interface SnapshotFile {
  readonly path: string;
  readonly encoding: string;
  readonly content: string;
}

interface LegacySnapshot {
  readonly version: number;
  readonly templateId: string;
  readonly packageJsonText?: string;
  readonly installArtifactIdentity?: string;
  readonly deps: Readonly<Record<string, string>>;
  readonly packages: number;
  readonly lockfile: string;
  readonly nodeModules: DepSnapshotV2['nodeModules'];
}

const publicDir = fileURLToPath(new URL('../../../apps/playground/public/', import.meta.url));
const identity = identityFile.identity;
if (!/^sha256:[a-f0-9]{64}$/.test(identity)) {
  throw new Error('generated install artifact identity is malformed');
}

function stringMapsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function archiveText(files: ReadonlyMap<string, SnapshotFile>, path: string): string | null {
  const file = files.get(path);
  if (!file) return null;
  if (file.encoding !== 'base64') throw new Error(`${path}: expected base64 archive member`);
  return Buffer.from(file.content, 'base64').toString('utf8');
}

function aliasDir(triggerDir: string, trigger: string, into: string): string {
  if (!triggerDir.endsWith(trigger)) {
    throw new Error(`snapshot shim: ${triggerDir} does not end with ${trigger}`);
  }
  return `${triggerDir.slice(0, triggerDir.length - trigger.length)}${into}`;
}

function proveCurrentShimBytes(snapshot: LegacySnapshot, label: string): void {
  const files = new Map(snapshot.nodeModules.files.map((file) => [file.path, file]));
  for (const [trigger, shim] of Object.entries(internalsShims)) {
    const manifestSuffix = `${trigger}/package.json`;
    const triggerDirs = [...files.keys()]
      .filter((path) => path === manifestSuffix || path.endsWith(`/node_modules/${manifestSuffix}`))
      .map((path) => path.slice(0, -'/package.json'.length));
    for (const triggerDir of triggerDirs) {
      const targetDir = shim.into ? aliasDir(triggerDir, trigger, shim.into) : triggerDir;
      for (const [relativePath, expected] of Object.entries(shim.files)) {
        const path = `${targetDir}/${relativePath}`;
        const actual = archiveText(files, path);
        if (actual !== expected) {
          throw new Error(
            `${label}: ${path} differs from current shadow artifact; run a full \`pnpm snapshots:bake\``,
          );
        }
      }
    }
  }
}

function migrateSnapshot(
  snapshot: LegacySnapshot,
  templateId: string,
  packageJsonText: string,
  label: string,
): DepSnapshotV2 {
  if (snapshot.version !== 1 && snapshot.version !== 2) {
    throw new Error(`${label}: unsupported snapshot version ${snapshot.version}`);
  }
  if (snapshot.templateId !== templateId) {
    throw new Error(`${label}: templateId ${snapshot.templateId} != ${templateId}`);
  }
  const deps = effectiveDepsFromPackageJsonText(packageJsonText);
  if (!deps || !stringMapsEqual(snapshot.deps, deps)) {
    throw new Error(`${label}: dependency request differs; run a full \`pnpm snapshots:bake\``);
  }
  proveCurrentShimBytes(snapshot, label);
  return {
    version: 2,
    templateId,
    packageJsonText,
    installArtifactIdentity: identity,
    deps: snapshot.deps,
    packages: snapshot.packages,
    lockfile: snapshot.lockfile,
    nodeModules: snapshot.nodeModules,
  };
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== '--write' && mode !== '--check') {
    throw new Error('usage: migrate-dep-snapshots-v2.ts --write|--check');
  }
  for (const spec of allProjectSpecs()) {
    if (!spec.bakedNodeModulesUrl) continue;
    const path = join(publicDir, ...spec.bakedNodeModulesUrl.replace(/^\/+/, '').split('/'));
    const before = await readFile(path);
    const snapshot = JSON.parse(gunzipSync(before).toString('utf8')) as LegacySnapshot;
    const packageJsonText = buildProjectPackageJson(spec).json;
    const migrated = migrateSnapshot(snapshot, spec.id, packageJsonText, spec.id);
    const after = gzipSync(Buffer.from(serializeDepSnapshot(migrated)), { level: 9 });
    if (mode === '--write') {
      await writeFile(path, after);
      console.log(`snapshot identity: migrated ${spec.id} (${dirname(path)})`);
    } else if (!before.equals(after)) {
      throw new Error(`${spec.id}: snapshot identity drifted; run \`pnpm snapshots:migrate-v2\``);
    }
  }
  if (mode === '--check') console.log('snapshot identity: current');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
