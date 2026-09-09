import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import { preparePackageEntryRuntime } from '@riftydev/shadow-registry/runtime';
import { syncMirror } from '@riftydev/vfs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inputFixture,
  registryFixture,
  registryUrl,
} from '../../../../tests/integration/fixtures/registry/rollup-companions/fixture.mjs';
import { produceDependencySnapshot } from '../index.ts';
import {
  type ExactFsTree,
  snapshotExactFsTree,
} from '../workers/test-fixtures/durable-owner-fs.ts';
import { decodeDepSnapshotTar } from './dep-snapshot-tar.ts';
import { parseDepSnapshot, restoreDepSnapshot } from './dep-snapshot.ts';

const encoder = new TextEncoder();

function expectExactTree(actual: ExactFsTree, expected: ExactFsTree): void {
  expect(actual.directories).toEqual(expected.directories);
  expect(Object.keys(actual.files)).toEqual(Object.keys(expected.files));
  for (const [path, bytes] of Object.entries(expected.files)) {
    const found = actual.files[path];
    expect(found, path).toBeDefined();
    if (found !== undefined) expect(Buffer.compare(found, bytes), path).toBe(0);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

describe('dependency snapshot installed-file preparation', () => {
  it('[fault: sibling-drift] concurrently emits startup-ready real Vite bytes without borrowing the current owner filesystem', async () => {
    const input = await inputFixture('nested');
    const registry = await registryFixture();
    const ambient = createMemoryFs();
    ambient.fsSync.mkdirSync('/workspace/node_modules/vite/dist/node', { recursive: true });
    ambient.fsSync.writeFileSync(
      '/workspace/node_modules/vite/dist/node/cli.js',
      encoder.encode('unrelated live owner bytes; not a Vite patch input'),
    );
    setSyncMirror(ambient.fsSync, { async: ambient.vfs });
    const before = snapshotExactFsTree(ambient.fsSync);
    vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
      expect(syncMirror(), 'producer cannot replace the owner during acquisition').toBe(
        ambient.fsSync,
      );
      return registry.fetch(...args);
    });

    const outputs = await Promise.all(
      ['first-producer', 'second-producer'].map((templateId) =>
        produceDependencySnapshot({ ...input, registryUrl, templateId }),
      ),
    );
    expect(syncMirror()).toBe(ambient.fsSync);
    expectExactTree(snapshotExactFsTree(ambient.fsSync), before);
    expect(outputs[0]?.snapshotId).not.toBe(outputs[1]?.snapshotId);

    for (const [index, output] of outputs.entries()) {
      const payload = parseDepSnapshot(
        JSON.stringify(decodeDepSnapshotTar(new Uint8Array(gunzipSync(output.archive)))),
      );
      const restored = createMemoryFs();
      const root = `/restored-${index}`;
      restored.fsSync.mkdirSync(root, { recursive: true });
      restored.fsSync.writeFileSync(
        `${root}/package.json`,
        encoder.encode(payload.packageJsonText),
      );
      await restoreDepSnapshot(restored.fsSync, root, payload);
      setSyncMirror(restored.fsSync, { async: restored.vfs });
      const exactPayload = snapshotExactFsTree(restored.fsSync);

      // Informational launch validates both real Vite transforms, without starting esbuild.
      const failure = await preparePackageEntryRuntime({
        bin: true,
        root,
        args: ['--version'],
        entryPath: `${root}/node_modules/.bin/vite`,
        runtimeBindings: [],
        fs: restored.fsSync,
      }).then(
        () => undefined,
        (error: unknown) => String(error),
      );
      expect.soft(failure).toBeUndefined();
      expectExactTree(snapshotExactFsTree(restored.fsSync), exactPayload);
    }
  }, 90_000);
});
