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

function expectation(value = snapshot()): SnapshotArtifactExpectation {
  return {
    bytes: canonical(value),
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

  it('rejects a stale install artifact identity without relabeling it', () => {
    const value = { ...snapshot(), installArtifactIdentity: `sha256:${'b'.repeat(64)}` };
    expect(() => assertSnapshotArtifactCurrent(expectation(value))).toThrow(
      /installArtifactIdentity.*pnpm snapshots:bake/,
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

  it('rejects semantically equal but noncanonical archive bytes', () => {
    const input = {
      ...expectation(),
      bytes: gzipSync(Buffer.from(`${serialize(snapshot())}\n`), { level: 9 }),
    };
    expect(() => assertSnapshotArtifactCurrent(input)).toThrow(
      /gzip bytes are not canonical.*pnpm snapshots:bake/,
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
});
