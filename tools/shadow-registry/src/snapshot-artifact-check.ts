import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

interface SnapshotFile {
  readonly path: string;
  readonly encoding: 'base64';
  readonly content: string;
}

export interface CheckedDepSnapshot {
  readonly version: 3;
  readonly templateId: string;
  readonly packageJsonText: string;
  readonly installArtifactIdentity: string;
  readonly deps: Readonly<Record<string, string>>;
  readonly packages: number;
  readonly lockfile: string;
  readonly tarballCache: {
    readonly version: 1;
    readonly root: string;
    readonly files: readonly SnapshotFile[];
  };
  readonly nodeModules: {
    readonly version: 1;
    readonly root: string;
    readonly files: readonly SnapshotFile[];
  };
}

export interface SnapshotShim {
  readonly into?: string;
  readonly files: Readonly<Record<string, string>>;
}

export interface SnapshotArtifactExpectation {
  readonly bytes: Uint8Array;
  readonly snapshotId?: string;
  readonly label: string;
  readonly templateId: string;
  readonly packageJsonText: string;
  readonly installArtifactIdentity: string;
  readonly deps: Readonly<Record<string, string>>;
  readonly shims: Readonly<Record<string, SnapshotShim>>;
  readonly canonicalize: (snapshot: CheckedDepSnapshot) => string;
  /** Prove every post-restore installed-tree transform can consume these bytes. */
  readonly validateInstallFiles?: (files: ReadonlyMap<string, Uint8Array>) => void;
}

function stale(label: string, reason: string): never {
  throw new Error(`${label}: ${reason}; run a full \`pnpm snapshots:bake\``);
}

function isStringMap(value: unknown): value is Readonly<Record<string, string>> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function parseSnapshot(json: string, label: string): CheckedDepSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    stale(label, 'snapshot is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || !('version' in raw)) {
    stale(label, 'snapshot metadata is malformed');
  }
  if (raw.version !== 3) stale(label, `snapshot version ${String(raw.version)} is not v3`);

  const snapshot = raw as Partial<CheckedDepSnapshot>;
  const files = snapshot.nodeModules?.files;
  const cacheFiles = snapshot.tarballCache?.files;
  if (
    typeof snapshot.templateId !== 'string' ||
    typeof snapshot.packageJsonText !== 'string' ||
    typeof snapshot.installArtifactIdentity !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(snapshot.installArtifactIdentity) ||
    !isStringMap(snapshot.deps) ||
    typeof snapshot.packages !== 'number' ||
    typeof snapshot.lockfile !== 'string' ||
    snapshot.tarballCache?.version !== 1 ||
    snapshot.tarballCache.root !== '/.rifty/tarball-cache' ||
    !Array.isArray(cacheFiles) ||
    !cacheFiles.every(
      (file) =>
        !!file &&
        typeof file === 'object' &&
        typeof file.path === 'string' &&
        file.encoding === 'base64' &&
        typeof file.content === 'string',
    ) ||
    snapshot.nodeModules?.version !== 1 ||
    typeof snapshot.nodeModules.root !== 'string' ||
    !Array.isArray(files) ||
    !files.every(
      (file) =>
        !!file &&
        typeof file === 'object' &&
        typeof file.path === 'string' &&
        file.encoding === 'base64' &&
        typeof file.content === 'string',
    )
  ) {
    stale(label, 'snapshot metadata is malformed');
  }
  return snapshot as CheckedDepSnapshot;
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
  return file ? Buffer.from(file.content, 'base64').toString('utf8') : null;
}

function aliasDir(triggerDir: string, trigger: string, into: string): string {
  if (!triggerDir.endsWith(trigger)) {
    throw new Error(`snapshot shim: ${triggerDir} does not end with ${trigger}`);
  }
  return `${triggerDir.slice(0, triggerDir.length - trigger.length)}${into}`;
}

function proveCurrentShimBytes(
  snapshot: CheckedDepSnapshot,
  label: string,
  shims: Readonly<Record<string, SnapshotShim>>,
): void {
  const files = new Map(snapshot.nodeModules.files.map((file) => [file.path, file]));
  for (const [trigger, shim] of Object.entries(shims)) {
    const manifestSuffix = `${trigger}/package.json`;
    const triggerDirs = [...files.keys()]
      .filter((path) => path === manifestSuffix || path.endsWith(`/node_modules/${manifestSuffix}`))
      .map((path) => path.slice(0, -'/package.json'.length));
    for (const triggerDir of triggerDirs) {
      const targetDir = shim.into ? aliasDir(triggerDir, trigger, shim.into) : triggerDir;
      for (const [relativePath, expected] of Object.entries(shim.files)) {
        const path = `${targetDir}/${relativePath}`;
        if (archiveText(files, path) !== expected) {
          stale(label, `${path} differs from the current shadow artifact`);
        }
      }
    }
  }
}

/** Read-only contract/drift gate. Never rewrites or relabels an archive. */
export function assertSnapshotArtifactCurrent(
  expectation: SnapshotArtifactExpectation,
): CheckedDepSnapshot {
  if (
    typeof expectation.snapshotId !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(expectation.snapshotId)
  ) {
    stale(expectation.label, 'snapshotId is missing or malformed');
  }
  let serialized: Buffer;
  let json: string;
  try {
    serialized = gunzipSync(expectation.bytes);
    json = serialized.toString('utf8');
  } catch {
    stale(expectation.label, 'snapshot is not a valid gzip archive');
  }
  const snapshot = parseSnapshot(json, expectation.label);
  if (snapshot.templateId !== expectation.templateId) {
    stale(expectation.label, `templateId ${snapshot.templateId} != ${expectation.templateId}`);
  }
  if (snapshot.packageJsonText !== expectation.packageJsonText) {
    stale(expectation.label, 'packageJsonText differs from the current template');
  }
  if (snapshot.installArtifactIdentity !== expectation.installArtifactIdentity) {
    stale(expectation.label, 'installArtifactIdentity differs from the current artifact');
  }
  if (!stringMapsEqual(snapshot.deps, expectation.deps)) {
    stale(expectation.label, 'dependency request differs from the current template');
  }
  proveCurrentShimBytes(snapshot, expectation.label, expectation.shims);
  if (expectation.validateInstallFiles) {
    const files = new Map(
      snapshot.nodeModules.files.map((file) => [
        file.path,
        new Uint8Array(Buffer.from(file.content, 'base64')),
      ]),
    );
    try {
      expectation.validateInstallFiles(files);
    } catch (error) {
      stale(
        expectation.label,
        error instanceof Error
          ? error.message
          : `installed-tree transform failed: ${String(error)}`,
      );
    }
  }

  const canonical = Buffer.from(expectation.canonicalize(snapshot));
  if (!serialized.equals(canonical)) {
    stale(expectation.label, 'serialized snapshot bytes are not canonical');
  }
  const snapshotId = `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
  if (snapshotId !== expectation.snapshotId) {
    stale(expectation.label, 'snapshotId differs from the exact serialized snapshot bytes');
  }
  return snapshot;
}
