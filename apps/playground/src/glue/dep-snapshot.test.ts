import { MemoryFsSync, createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  type DepSnapshotV2,
  buildDepSnapshot,
  fetchDepSnapshot,
  parseDepSnapshot,
  restoreDepSnapshot,
} from './dep-snapshot.ts';
import { ensureProjectDependencies } from './project-deps.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

const ROOT = '/workspace';
const PACKAGE_JSON_TEXT = JSON.stringify({
  name: 'app',
  dependencies: { vite: '^5.4.0' },
});

function write(fs: MemoryFsSync, path: string, bytes: Uint8Array): void {
  const slash = path.lastIndexOf('/');
  fs.mkdirSync(path.slice(0, slash), { recursive: true });
  fs.writeFileSync(path, bytes);
}

function bakedFs(): MemoryFsSync {
  const fs = new MemoryFsSync();
  write(fs, `${ROOT}/package.json`, enc.encode(PACKAGE_JSON_TEXT));
  write(fs, `${ROOT}/package-lock.json`, enc.encode('{"lockfileVersion":3}'));
  write(fs, `${ROOT}/node_modules/vite/package.json`, enc.encode('{"name":"vite"}'));
  write(fs, `${ROOT}/node_modules/vite/bin/vite.js`, enc.encode('#!/usr/bin/env node'));
  // nested copy (nest-on-conflict layout) must survive the round-trip
  write(fs, `${ROOT}/node_modules/a/node_modules/ms/index.js`, enc.encode('nested'));
  // binary content round-trips byte-exact through base64
  write(fs, `${ROOT}/node_modules/vite/blob.bin`, new Uint8Array([0, 255, 128, 7]));
  // install-time shadow shims (ADR-0188): the bake runs the same install(), so
  // the shimmed native entry + the alias package are tree files like any other
  // and MUST ride the snapshot (no boot overlay recreates them anymore).
  write(
    fs,
    `${ROOT}/node_modules/rollup/dist/native.js`,
    enc.encode("require('@rollup/wasm-node/dist/native.js')"),
  );
  write(fs, `${ROOT}/node_modules/esbuild/package.json`, enc.encode('{"name":"esbuild"}'));
  return fs;
}

describe('dep snapshot (ADR-0135)', () => {
  it('round-trips the node_modules tree, nested copies, binaries, and the lockfile', () => {
    const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    const reparsed = parseDepSnapshot(JSON.stringify(snapshot));

    const target = new MemoryFsSync();
    target.mkdirSync(ROOT, { recursive: true });
    restoreDepSnapshot(target, ROOT, reparsed);

    expect(dec.decode(target.readFileBytesSync(`${ROOT}/node_modules/vite/package.json`))).toBe(
      '{"name":"vite"}',
    );
    expect(target.existsSync(`${ROOT}/node_modules/a/node_modules/ms/index.js`)).toBe(true);
    expect([...target.readFileBytesSync(`${ROOT}/node_modules/vite/blob.bin`)]).toEqual([
      0, 255, 128, 7,
    ]);
    expect(dec.decode(target.readFileBytesSync(`${ROOT}/package-lock.json`))).toBe(
      '{"lockfileVersion":3}',
    );
    // install-time shim files restored verbatim (ADR-0188)
    expect(dec.decode(target.readFileBytesSync(`${ROOT}/node_modules/rollup/dist/native.js`))).toBe(
      "require('@rollup/wasm-node/dist/native.js')",
    );
    expect(target.existsSync(`${ROOT}/node_modules/esbuild/package.json`)).toBe(true);
    expect(reparsed.packages).toBe(8);
    expect(reparsed.deps).toEqual({ vite: '^5.4.0' });
    expect(reparsed.packageJsonText).toBe(PACKAGE_JSON_TEXT);
    expect(reparsed.installArtifactIdentity).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('restores the baked tree into a DIFFERENT root (multi-project dynamic root, ADR-0165)', () => {
    // Baked at /workspace, restored into a per-project root. Archive paths are
    // root-RELATIVE, so the restore must RE-ROOT, not throw "Archive root mismatch"
    // — the multi-project active root is /scratch or /projects/<id>, never the
    // bake root, so a strict root-equality check would force a slow install on
    // every boot (the instant-boot contract, ADR-0135, would be lost).
    const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    const target = new MemoryFsSync();
    const projectRoot = '/projects/p1';
    restoreDepSnapshot(target, projectRoot, snapshot);

    expect(
      dec.decode(target.readFileBytesSync(`${projectRoot}/node_modules/vite/package.json`)),
    ).toBe('{"name":"vite"}');
    expect(target.existsSync(`${projectRoot}/node_modules/a/node_modules/ms/index.js`)).toBe(true);
    expect(dec.decode(target.readFileBytesSync(`${projectRoot}/package-lock.json`))).toBe(
      '{"lockfileVersion":3}',
    );
    // and NOT leaked at the bake root
    expect(target.existsSync(`${ROOT}/node_modules/vite/package.json`)).toBe(false);
  });

  it('restore REPLACES a stale node_modules instead of merging over it', () => {
    const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });

    const target = new MemoryFsSync();
    write(target, `${ROOT}/node_modules/stale-pkg/index.js`, enc.encode('stale'));
    restoreDepSnapshot(target, ROOT, snapshot);

    expect(target.existsSync(`${ROOT}/node_modules/stale-pkg/index.js`)).toBe(false);
    expect(target.existsSync(`${ROOT}/node_modules/vite/package.json`)).toBe(true);
  });

  it('rejects malformed snapshots loudly', () => {
    expect(() => parseDepSnapshot('{"version":1}')).toThrow('version');
    expect(() => parseDepSnapshot('{"version":2,"templateId":"vite"}')).toThrow('Malformed');
    const mismatched = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    expect(() =>
      parseDepSnapshot(JSON.stringify({ ...mismatched, deps: { vite: '^6.0.0' } })),
    ).toThrow('packageJsonText');
  });

  it('does not accept a snapshot missing the current install-artifact identity when package.json is unchanged', async () => {
    const { vfs, fsSync } = createMemoryFs();
    fsSync.mkdirSync(ROOT, { recursive: true });
    fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON_TEXT));
    const { installArtifactIdentity: _missing, ...rawSnapshot } = JSON.parse(
      JSON.stringify(
        buildDepSnapshot(bakedFs(), ROOT, {
          templateId: 'vite',
          deps: { vite: '^5.4.0' },
          packages: 8,
        }),
      ),
    ) as Record<string, unknown>;
    let installed = false;
    const options = {
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => rawSnapshot as unknown as DepSnapshotV2,
      install: async () => {
        installed = true;
        return { packages: 9 };
      },
      log: () => undefined,
    } satisfies Parameters<typeof ensureProjectDependencies>[0];

    const result = await ensureProjectDependencies(options);

    expect(result).toEqual({ source: 'install', packages: 9 });
    expect(installed).toBe(true);
  });

  it('does not restore the same dependency map when package.json overrides drift', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    fsSync.mkdirSync(ROOT, { recursive: true });
    fsSync.writeFileSync(
      `${ROOT}/package.json`,
      enc.encode(
        JSON.stringify({
          name: 'app',
          dependencies: { vite: '^5.4.0' },
          overrides: { esbuild: '@esbuild/wasi-preview1@0.28.0' },
        }),
      ),
    );

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => snapshot,
      install: async () => ({ packages: 9 }),
      log: () => undefined,
    });

    expect(result).toEqual({ source: 'install', packages: 9 });
  });

  it('does not restore package-identical bytes from a different install-artifact identity', async () => {
    const { vfs, fsSync } = createMemoryFs();
    fsSync.mkdirSync(ROOT, { recursive: true });
    fsSync.writeFileSync(`${ROOT}/package.json`, enc.encode(PACKAGE_JSON_TEXT));
    const snapshot = {
      ...buildDepSnapshot(bakedFs(), ROOT, {
        templateId: 'vite',
        deps: { vite: '^5.4.0' },
        packages: 8,
      }),
      installArtifactIdentity: `sha256:${'0'.repeat(64)}`,
    } satisfies DepSnapshotV2;

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => snapshot,
      install: async () => ({ packages: 9 }),
      log: () => undefined,
    });

    expect(result).toEqual({ source: 'install', packages: 9 });
  });

  it('fetchDepSnapshot handles raw gzip bytes AND server-decoded JSON (magic sniff)', async () => {
    const { gzipSync } = await import('node:zlib');
    const snapshot = buildDepSnapshot(bakedFs(), ROOT, {
      templateId: 'vite',
      deps: { vite: '^5.4.0' },
      packages: 8,
    });
    const json = JSON.stringify(snapshot);
    const originalFetch = globalThis.fetch;
    try {
      // Raw gzip bytes (static host serves .gz verbatim).
      globalThis.fetch = async () => new Response(new Uint8Array(gzipSync(json)));
      expect((await fetchDepSnapshot('/x.json.gz'))?.packages).toBe(8);

      // Already-decoded body (vite dev sets Content-Encoding: gzip on .gz).
      globalThis.fetch = async () => new Response(json);
      expect((await fetchDepSnapshot('/x.json.gz'))?.packages).toBe(8);

      // Failure → null, never a throw.
      globalThis.fetch = async () => new Response('nope', { status: 404 });
      expect(await fetchDepSnapshot('/x.json.gz')).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
