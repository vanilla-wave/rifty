import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { type Lockfile, extractTarGz, serializePackageJson } from '@riftydev/npm-client';
import {
  finalizeToolchainInstallFiles,
  preparePackageEntryRuntime,
} from '@riftydev/shadow-registry/runtime';
import { type FsSync, syncMirror } from '@riftydev/vfs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  inputFixture,
  registryFixture,
  registryUrl,
} from '../../../../tests/integration/fixtures/registry/rollup-companions/fixture.mjs';
import { produceDependencySnapshot } from '../glue/dep-snapshot-producer.ts';
import { decodeDepSnapshotTar } from '../glue/dep-snapshot-tar.ts';
import {
  type DepSnapshotV3,
  buildDepSnapshot,
  parseDepSnapshot,
  serializeDepSnapshot,
  serializeDepSnapshotTar,
} from '../glue/dep-snapshot.ts';
import { readInstallStampSync, stampTrusted } from '../glue/install-stamp.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type OpenedPlaygroundProject,
  createPlaygroundProjectAuthority,
} from './playground-project-authority.ts';
import { snapshotExactFsTree } from './test-fixtures/durable-owner-fs.ts';
import {
  type SavedSnapshotFixture,
  bakeSavedSnapshotFixture,
  installSnapshotNetwork,
  savedSnapshotDefinition,
} from './test-fixtures/snapshot-saved-state.ts';
import { workbenchFirstMaterializationPackageConfig } from './workbench-package-config.ts';

const encoder = new TextEncoder();
let vite: SavedSnapshotFixture;
let ms: SavedSnapshotFixture;
let unprepared: Readonly<Record<'json' | 'tar', SavedSnapshotFixture>>;

function fixture(
  payload: DepSnapshotV3,
  format: 'json' | 'tar',
  label = 'unprepared-vite',
): SavedSnapshotFixture {
  const bytes =
    format === 'json'
      ? encoder.encode(serializeDepSnapshot(payload))
      : serializeDepSnapshotTar(payload);
  const snapshotId = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  return {
    archive: new Uint8Array(gzipSync(bytes)),
    snapshotId,
    installArtifactIdentity: payload.installArtifactIdentity,
    payload,
    descriptor: {
      templateId: payload.templateId,
      snapshotId,
      assetUrl: `https://host.test/${label}.${format}.gz`,
    },
  };
}

beforeAll(async () => {
  const input = await inputFixture('nested');
  const registry = await registryFixture();
  vi.stubGlobal('fetch', registry.fetch);
  const produced = await produceDependencySnapshot({
    ...input,
    registryUrl,
    templateId: 'saved-ms',
  });
  const payload = parseDepSnapshot(
    JSON.stringify(decodeDepSnapshotTar(new Uint8Array(gunzipSync(produced.archive)))),
  );
  vite = {
    ...produced,
    payload,
    descriptor: {
      snapshotId: produced.snapshotId,
      templateId: payload.templateId,
      assetUrl: 'https://host.test/prepared-vite.tar.gz',
    },
  };
  // Restore original immutable npm Vite files, independent of the producer's patch policy.
  const original = await extractTarGz(registry.tarball('vite', '7.3.6'));
  const raw: DepSnapshotV3 = {
    ...payload,
    nodeModules: {
      ...payload.nodeModules,
      files: payload.nodeModules.files.map((file) => {
        const bytes = file.path.startsWith('vite/')
          ? original[file.path.slice('vite/'.length)]
          : undefined;
        return bytes === undefined
          ? file
          : { ...file, content: Buffer.from(bytes).toString('base64') };
      }),
    },
  };
  unprepared = { json: fixture(raw, 'json'), tar: fixture(raw, 'tar') };
  ms = await bakeSavedSnapshotFixture();
}, 90_000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSyncMirror();
});

/** Same owner/package composition as the browser; only storage and network boundaries differ. */
async function openOwner(...additional: SavedSnapshotFixture[]) {
  const network = installSnapshotNetwork(vite, ms, unprepared.json, unprepared.tar, ...additional);
  const memory = createMemoryFs();
  const composition = createOwnerVfsAuthorityComposition(memory.fsSync, {
    initialRoots: ['/', '/.rifty'],
  });
  const vfs = new SyncMirrorVfs();
  setSyncMirror(composition.authority, { async: vfs });
  const packages = createOwnerPackageState({
    vfs,
    fsSync: composition.authority,
    installStampClaims: composition.installStampClaims,
    flush: () => composition.authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
  });
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'ephemeral',
    now: () => '2026-09-09T00:00:00.000Z',
    createStageId: () => crypto.randomUUID(),
    acquisition: {
      ensure: (request) =>
        packages.activateAndEnsure(
          workbenchFirstMaterializationPackageConfig(request, composition.authority),
          request.snapshotAdmission,
        ),
    },
    projectSave: packages,
  });
  return {
    ...composition,
    ...memory,
    owner,
    packages,
    network,
    async close() {
      await owner.close();
      await packages.quiesce();
    },
  };
}

function definition(artifact: SavedSnapshotFixture, conflict?: 'error' | 'overwrite') {
  return savedSnapshotDefinition('scratch', artifact.descriptor, {
    packageJsonText: artifact.payload.packageJsonText,
    ...(conflict === undefined ? {} : { application: { mode: 'apply-snapshot', conflict } }),
  });
}

function launch(root: string) {
  return preparePackageEntryRuntime({
    bin: true,
    root,
    args: ['--version'],
    entryPath: `${root}/node_modules/.bin/vite`,
    runtimeBindings: [],
    fs: syncMirror(),
  });
}

function expectPayload(fs: FsSync, root: string, payload: DepSnapshotV3): void {
  for (const [path, text] of [
    ['package.json', payload.packageJsonText],
    ['package-lock.json', payload.lockfile],
  ]) {
    expect(
      Buffer.compare(fs.readFileBytesSync(`${root}/${path}`), encoder.encode(text)),
      path,
    ).toBe(0);
  }
  for (const file of payload.nodeModules.files) {
    expect(
      Buffer.compare(
        fs.readFileBytesSync(`${root}/node_modules/${file.path}`),
        Buffer.from(file.content, 'base64'),
      ),
      file.path,
    ).toBe(0);
  }
  for (const path of payload.nodeModules.directories ?? []) {
    expect(fs.statSync(`${root}/node_modules/${path}`).isDirectory, path).toBe(true);
  }
}

function treeDigest(fs: FsSync): string {
  const tree = snapshotExactFsTree(fs);
  const hash = createHash('sha256').update(JSON.stringify(tree.directories));
  for (const [path, bytes] of Object.entries(tree.files)) {
    hash.update(JSON.stringify([path, bytes.length])).update(bytes);
  }
  return hash.digest('hex');
}

async function expectUnpreparedRefusal(artifact: SavedSnapshotFixture): Promise<void> {
  const h = await openOwner(artifact);
  const saved = definition(ms);
  await h.owner.createScratch({ definition: saved });
  const first = await h.owner.openProject(saved);
  await first.close();
  h.network.requests.length = 0;
  const before = treeDigest(h.authority);
  const catalog = h.owner.catalogSnapshot();
  const changes = (
    ['writeFileSync', 'mkdirSync', 'rmSync', 'renameSync', 'copyFileSync', 'cpSync'] as const
  ).map((method) => vi.spyOn(h.fsSync, method));
  let opened: OpenedPlaygroundProject | undefined;
  let failure: unknown;
  try {
    try {
      opened = await h.owner.openProject(definition(artifact, 'overwrite'));
    } catch (error) {
      failure = error;
    }
    expect.soft(opened === undefined, 'unprepared source cannot become a ready project').toBe(true);
    expect.soft(String(failure)).toMatch(/re-?bake/i);
    expect
      .soft(treeDigest(h.authority), 'all prior source, cache and claim bytes remain')
      .toBe(before);
    expect.soft(h.owner.catalogSnapshot()).toEqual(catalog);
    for (const change of changes) expect.soft(change.mock.calls.length).toBe(0);
    expect(h.network.requests).toEqual([artifact.descriptor.assetUrl]);
  } finally {
    for (const change of changes) change.mockRestore();
    await opened?.close();
    await h.close();
  }
}

const emnapiCopies = ['@emnapi/core', '@emnapi/wasi-threads/node_modules/@emnapi/core'] as const;
const emnapiFiles = [
  ['dist/emnapi-core.cjs.js', 'readable'],
  ['dist/emnapi-core.cjs.min.js', 'minified'],
] as const;

async function realEmnapiFixture(): Promise<SavedSnapshotFixture> {
  const baked = parseDepSnapshot(
    gunzipSync(
      await readFile(
        new URL(
          '../../../../apps/playground/public/snapshots/vite8-node-modules.json.gz',
          import.meta.url,
        ),
      ),
    ).toString(),
  );
  const original = JSON.parse(baked.lockfile) as Lockfile;
  const dependencies = { '@emnapi/core': '1.10.0' };
  const manifest = { name: 'snapshot-emnapi', version: '1.0.0', dependencies };
  const packageNames = ['@emnapi/core', '@emnapi/wasi-threads', 'tslib'];
  const packages = Object.fromEntries(
    packageNames.map((name) => {
      const pin = original.packages[`node_modules/${name}`];
      if (pin === undefined) throw new Error(`Committed real emnapi closure lacks ${name}`);
      return [`node_modules/${name}`, pin];
    }),
  );
  // A retained nested copy uses the same real package/pin, not invented patch-anchor files.
  const nested = emnapiCopies[1];
  const memory = createMemoryFs();
  const root = '/fixture';
  memory.fsSync.mkdirSync(root, { recursive: true });
  memory.fsSync.writeFileSync(
    `${root}/package.json`,
    encoder.encode(serializePackageJson(manifest)),
  );
  memory.fsSync.writeFileSync(
    `${root}/package-lock.json`,
    encoder.encode(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': manifest,
          ...packages,
          [`node_modules/${nested}`]: original.packages['node_modules/@emnapi/core'],
        },
      }),
    ),
  );
  for (const file of baked.nodeModules.files) {
    if (!packageNames.some((name) => file.path.startsWith(`${name}/`))) continue;
    const paths = [file.path];
    if (file.path.startsWith('@emnapi/core/'))
      paths.push(`${nested}/${file.path.slice('@emnapi/core/'.length)}`);
    for (const relative of paths) {
      const path = `${root}/node_modules/${relative}`;
      memory.fsSync.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      memory.fsSync.writeFileSync(path, Buffer.from(file.content, 'base64'));
    }
  }
  return fixture(
    buildDepSnapshot(memory.fsSync, root, {
      templateId: 'saved-ms',
      deps: dependencies,
      packages: 4,
    }),
    'tar',
    'real-emnapi-unprepared',
  );
}

describe('snapshot application preserves prepared source authority', () => {
  it('[fault: sibling-drift] fresh apply and same-ID reapply admit real Vite startup and keep literal payload bytes', async () => {
    const h = await openOwner();
    const apply = definition(vite, 'error');
    await h.owner.createScratch({ definition: apply });
    try {
      for (let pass = 0; pass < 2; pass++) {
        const opened = await h.owner.openProject(apply);
        try {
          expect(opened.acquisition).toMatchObject({
            kind: 'ready',
            provenance: { outcome: 'snapshot', snapshotId: vite.snapshotId },
          });
          expectPayload(h.authority, opened.projectRoot, vite.payload);
          const beforeStartup = treeDigest(h.authority);
          const failure = await launch(opened.projectRoot).then(
            () => undefined,
            (error: unknown) => String(error),
          );
          expect.soft(failure).toBeUndefined();
          expect(
            treeDigest(h.authority),
            'startup cannot repair installed bytes after promotion',
          ).toBe(beforeStartup);
        } finally {
          await opened.close();
        }
      }
      expect(h.network.requests).toEqual([vite.descriptor.assetUrl, vite.descriptor.assetUrl]);
    } finally {
      await h.close();
    }
  }, 90_000);

  it('applying ms preserves unrelated malformed saved Vite files byte-for-byte', async () => {
    const h = await openOwner();
    const initial = definition(ms);
    await h.owner.createScratch({ definition: initial });
    const first = await h.owner.openProject(initial);
    const root = first.projectRoot;
    const path = `${root}/node_modules/vite/dist/node/cli.js`;
    const saved = encoder.encode('saved user bytes, deliberately not a Vite patch input');
    try {
      await h.packages.mutations.guardedMutation([{ kind: 'replace', path }], async () => {
        h.authority.mkdirSync(`${root}/node_modules/vite/dist/node`, { recursive: true });
        h.authority.writeFileSync(path, saved);
      });
      await h.owner.recordMutation({
        project: first,
        kind: 'file',
        treeRevision: h.authority.treeRevision,
      });
      await first.close();
      const applied = await h.owner.openProject(definition(ms, 'error'));
      try {
        expectPayload(h.authority, root, ms.payload);
        expect(Buffer.compare(h.authority.readFileBytesSync(path), saved)).toBe(0);
      } finally {
        await applied.close();
      }
    } finally {
      await first.close();
      await h.close();
    }
  });

  it.each(['json', 'tar'] as const)(
    '[fault: provenance-lie] refuses old unprepared %s before tree/cache/claim effects, while initial restore remains supported',
    async (format) => {
      const artifact = unprepared[format];
      const legacy = await openOwner();
      const initial = definition(artifact);
      await legacy.owner.createScratch({ definition: initial });
      try {
        const opened = await legacy.owner.openProject(initial);
        try {
          await expect(launch(opened.projectRoot)).resolves.toBeUndefined();
          const claim = readInstallStampSync(legacy.authority, opened.projectRoot);
          expect(claim !== null && stampTrusted(claim)).toBe(true);
        } finally {
          await opened.close();
        }
      } finally {
        await legacy.close();
      }

      await expectUnpreparedRefusal(artifact);
    },
    90_000,
  );

  it('prepares both real @emnapi/core CJS forms at hoisted/nested paths on initial restore and rejects each unprepared apply source', async () => {
    const raw = await realEmnapiFixture();
    const h = await openOwner(raw);
    const initial = definition(raw);
    await h.owner.createScratch({ definition: initial });
    let prepared: DepSnapshotV3;
    try {
      const opened = await h.owner.openProject(initial);
      try {
        for (const copy of emnapiCopies) {
          for (const [file] of emnapiFiles) {
            const path = `${copy}/${file}`;
            const original = raw.payload.nodeModules.files.find((entry) => entry.path === path);
            if (original === undefined) throw new Error(`Real emnapi file missing: ${path}`);
            const bytes = h.authority.readFileBytesSync(
              `${opened.projectRoot}/node_modules/${path}`,
            );
            expect(Buffer.compare(bytes, Buffer.from(original.content, 'base64')), path).not.toBe(
              0,
            );
          }
        }
        const beforeFinalizer = treeDigest(h.authority);
        const writes = vi.spyOn(h.fsSync, 'writeFileSync');
        try {
          finalizeToolchainInstallFiles({ root: opened.projectRoot, fs: h.authority });
          expect(
            writes.mock.calls.length,
            'initial restore completed every generic transform',
          ).toBe(0);
          expect(treeDigest(h.authority)).toBe(beforeFinalizer);
        } finally {
          writes.mockRestore();
        }
        const claim = readInstallStampSync(h.authority, opened.projectRoot);
        expect(claim !== null && stampTrusted(claim)).toBe(true);
        prepared = buildDepSnapshot(h.authority, opened.projectRoot, {
          templateId: raw.payload.templateId,
          deps: raw.payload.deps,
          packages: raw.payload.packages,
        });
      } finally {
        await opened.close();
      }
    } finally {
      await h.close();
    }
    for (const [index, copy] of emnapiCopies.entries()) {
      for (const [file, format] of emnapiFiles) {
        const path = `${copy}/${file}`;
        const original = raw.payload.nodeModules.files.find((entry) => entry.path === path);
        if (original === undefined) throw new Error(`Real emnapi file missing: ${path}`);
        const payload = {
          ...prepared,
          nodeModules: {
            ...prepared.nodeModules,
            files: prepared.nodeModules.files.map((entry) =>
              entry.path === path ? original : entry,
            ),
          },
        };
        await expectUnpreparedRefusal(fixture(payload, 'tar', `emnapi-${index}-${format}`));
      }
    }
  }, 90_000);
});
