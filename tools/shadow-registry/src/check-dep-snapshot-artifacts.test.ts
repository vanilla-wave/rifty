import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  type CheckedDepSnapshot,
  type SnapshotArtifactExpectation,
  assertSnapshotArtifactCurrent,
} from './snapshot-artifact-check.ts';

const CURRENT_IDENTITY = `sha256:${'a'.repeat(64)}`;
const PACKAGE_JSON_TEXT = '{"dependencies":{"native":"1.0.0"}}';
const CURRENT_SHIM = 'module.exports = "current";';

function base64(text: string): string {
  return Buffer.from(text).toString('base64');
}

function serialize(snapshot: CheckedDepSnapshot): string {
  return JSON.stringify({
    version: snapshot.version,
    templateId: snapshot.templateId,
    deps: snapshot.deps,
    packages: snapshot.packages,
    packageJsonText: snapshot.packageJsonText,
    installArtifactIdentity: snapshot.installArtifactIdentity,
    lockfile: snapshot.lockfile,
    nodeModules: snapshot.nodeModules,
  });
}

function snapshot(): CheckedDepSnapshot {
  return {
    version: 2,
    templateId: 'fixture',
    deps: { native: '1.0.0' },
    packages: 1,
    packageJsonText: PACKAGE_JSON_TEXT,
    installArtifactIdentity: CURRENT_IDENTITY,
    lockfile: '{}',
    nodeModules: {
      version: 1,
      root: '/workspace/node_modules',
      files: [
        { path: 'native/package.json', encoding: 'base64', content: base64('{"name":"native"}') },
        { path: 'native/main.js', encoding: 'base64', content: base64(CURRENT_SHIM) },
      ],
    },
  };
}

function canonical(value: CheckedDepSnapshot): Buffer {
  return gzipSync(Buffer.from(serialize(value)), { level: 9 });
}

function snapshotId(value: CheckedDepSnapshot): string {
  return `sha256:${createHash('sha256').update(serialize(value)).digest('hex')}`;
}

function expectation(
  value = snapshot(),
): SnapshotArtifactExpectation & { readonly snapshotId: string } {
  return {
    bytes: canonical(value),
    snapshotId: snapshotId(value),
    label: 'fixture',
    templateId: 'fixture',
    packageJsonText: PACKAGE_JSON_TEXT,
    installArtifactIdentity: CURRENT_IDENTITY,
    deps: { native: '1.0.0' },
    shims: { native: { files: { 'main.js': CURRENT_SHIM } } },
    canonicalize: serialize,
  };
}

describe('snapshot artifact drift check', () => {
  it('accepts a canonical current v2 artifact', () => {
    expect(() => assertSnapshotArtifactCurrent(expectation())).not.toThrow();
  });

  it('accepts canonical serialized bytes compressed by another valid gzip encoder setting', () => {
    const input = {
      ...expectation(),
      bytes: gzipSync(Buffer.from(serialize(snapshot())), { level: 1 }),
    };

    expect(() => assertSnapshotArtifactCurrent(input)).not.toThrow();
  });

  it('rejects a stale install artifact identity without relabeling it', () => {
    const value = { ...snapshot(), installArtifactIdentity: `sha256:${'b'.repeat(64)}` };
    expect(() => assertSnapshotArtifactCurrent(expectation(value))).toThrow(
      /installArtifactIdentity.*pnpm snapshots:bake/,
    );
  });

  it('rejects a stale bake-owned snapshot identity derived from other serialized bytes', () => {
    const input = { ...expectation(), snapshotId: `sha256:${'b'.repeat(64)}` };

    expect(() => assertSnapshotArtifactCurrent(input)).toThrow(/snapshotId.*pnpm snapshots:bake/);
  });

  it('rejects an artifact check that omits bake-owned snapshot identity', () => {
    const { snapshotId: _omitted, ...input } = expectation();

    expect(() => assertSnapshotArtifactCurrent(input as SnapshotArtifactExpectation)).toThrow(
      /snapshotId.*pnpm snapshots:bake/,
    );
  });

  it('rejects legacy v1 metadata instead of migrating it', () => {
    const legacy = { ...snapshot(), version: 1 };
    const input = {
      ...expectation(),
      bytes: gzipSync(Buffer.from(JSON.stringify(legacy)), { level: 9 }),
    };
    expect(() => assertSnapshotArtifactCurrent(input)).toThrow(/version 1.*pnpm snapshots:bake/);
  });

  it('rejects semantically equal but noncanonical serialized bytes', () => {
    const input = {
      ...expectation(),
      bytes: gzipSync(Buffer.from(`${serialize(snapshot())}\n`), { level: 9 }),
    };
    expect(() => assertSnapshotArtifactCurrent(input)).toThrow(
      /serialized snapshot bytes are not canonical.*pnpm snapshots:bake/,
    );
  });

  it('rejects a tree whose declared shim bytes differ', () => {
    const value = snapshot();
    const files = value.nodeModules.files.map((file) =>
      file.path === 'native/main.js' ? { ...file, content: base64('stale') } : file,
    );
    const input = expectation({ ...value, nodeModules: { ...value.nodeModules, files } });
    expect(() => assertSnapshotArtifactCurrent(input)).toThrow(
      /native\/main\.js.*pnpm snapshots:bake/,
    );
  });

  it('runs installed-tree transform proof before accepting current metadata', () => {
    const value = snapshot();
    const input = {
      ...expectation(value),
      validateInstallFiles(files: ReadonlyMap<string, Uint8Array>): void {
        const source = files.get('native/main.js');
        if (!source || Buffer.from(source).toString('utf8') !== 'expected-transform-input') {
          throw new Error('native/main.js is not patchable by the current transform');
        }
      },
    };

    expect(() => assertSnapshotArtifactCurrent(input)).toThrow(
      /native\/main\.js is not patchable.*pnpm snapshots:bake/,
    );
  });
});
