/**
 * Tests for the owner-served workspace-archive export/import bridge
 * (single-store-owner acceptance: exactly one authoritative store owner, and
 * the page holds no authoritative fs — it reads through ports).
 *
 * Like the sibling request/response bridge (`node-modules-port.test.ts`), both
 * ends run in the same Node realm over distinct `BroadcastChannel` instances
 * keyed by the same port. The owner serves `exportWorkspaceArchive` /
 * `importWorkspaceArchive` against its realm-local `syncMirror()`, so the PAGE
 * needs no authoritative store of its own to download/upload a workspace.
 */

import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PackageMutationExecutor } from './package-mutation-executor.ts';
import {
  type WorkspaceArchiveBridge,
  bridgeWorkspaceArchive,
  serveWorkspaceArchive,
} from './workspace-archive-port.ts';
import type { WorkspaceArchiveV1 } from './workspace-archive.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

const teardowns: Array<() => void> = [];
let bridge: WorkspaceArchiveBridge | null = null;

const directPackageMutations: Pick<PackageMutationExecutor, 'reset'> = {
  reset: async (_target, prepare) => {
    const plan = await prepare();
    if (plan.status === 'ready') await plan.mutate();
  },
};

function serve(port: number, root = '/workspace'): void {
  teardowns.push(serveWorkspaceArchive(port, root, directPackageMutations));
}

function client(port: number, timeoutMs?: number): WorkspaceArchiveBridge {
  bridge = bridgeWorkspaceArchive(port, timeoutMs === undefined ? {} : { timeoutMs });
  return bridge;
}

beforeEach(() => {
  resetSyncMirror();
});

afterEach(() => {
  bridge?.dispose();
  bridge = null;
  for (const t of teardowns.splice(0)) t();
});

describe('owner-served workspace archive bridge', () => {
  it('export round-trips the owner source tree as an archive, excluding node_modules', async () => {
    const fs = syncMirror();
    fs.mkdirSync('/workspace/src', { recursive: true });
    fs.mkdirSync('/workspace/node_modules/dep', { recursive: true });
    fs.writeFileSync('/workspace/src/main.js', enc.encode('console.log(1)'));
    fs.writeFileSync('/workspace/node_modules/dep/index.js', enc.encode('module.exports={}'));
    serve(9101);

    const json = await client(9101).export();
    const archive = JSON.parse(json) as WorkspaceArchiveV1;

    expect(archive.version).toBe(1);
    expect(archive.root).toBe('/workspace');
    const paths = archive.files.map((f) => f.path);
    expect(paths).toContain('src/main.js');
    // node_modules is excluded from the archive (matches export defaults)
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false);
  });

  it.each([
    { failedDirectory: '/workspace', port: 9105 },
    { failedDirectory: '/workspace/src', port: 9106 },
  ])(
    'export rejects the exact readdir permission failure at $failedDirectory',
    async ({ failedDirectory, port }) => {
      const fs = syncMirror();
      fs.mkdirSync('/workspace/src', { recursive: true });
      fs.writeFileSync('/workspace/src/main.js', enc.encode('must-not-disappear'));
      const realReaddir = fs.readdirSync.bind(fs);
      const failure = new Error(`permission denied reading ${failedDirectory}`);
      failure.name = 'ArchivePermissionError';
      fs.readdirSync = ((path) => {
        if (path === failedDirectory) throw failure;
        return realReaddir(path);
      }) as typeof fs.readdirSync;
      serve(port);

      await expect(client(port).export()).rejects.toMatchObject({
        name: 'ArchivePermissionError',
        message: `permission denied reading ${failedDirectory}`,
      });
    },
  );

  it('import applies an archive into the owner tree (no PAGE store needed)', async () => {
    serve(9102);
    const archive: WorkspaceArchiveV1 = {
      version: 1,
      root: '/workspace',
      files: [{ path: 'src/app.js', encoding: 'base64', content: btoa('hello owner') }],
    };

    await client(9102).import(JSON.stringify(archive));

    expect(syncMirror().existsSync('/workspace/src/app.js')).toBe(true);
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/src/app.js'))).toBe('hello owner');
  });

  it('runs the whole-root archive replacement inside the supplied package FIFO', async () => {
    const events: string[] = [];
    teardowns.push(
      serveWorkspaceArchive(9104, '/workspace', {
        reset: async (target, prepare) => {
          events.push(`before:${target.root}`);
          const plan = await prepare();
          if (plan.status === 'ready') await plan.mutate();
          events.push(`after:${target.root}`);
        },
      }),
    );
    const archive: WorkspaceArchiveV1 = {
      version: 1,
      root: '/workspace',
      files: [{ path: 'package.json', encoding: 'base64', content: btoa('{"name":"next"}\n') }],
    };

    await client(9104).import(JSON.stringify(archive));

    expect(events).toEqual(['before:/workspace', 'after:/workspace']);
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/package.json'))).toBe(
      '{"name":"next"}\n',
    );
  });

  it('export rejects with a timeout when no owner is listening', async () => {
    await expect(client(9103, 50).export()).rejects.toThrow(/timeout/i);
  });

  it('keeps an admitted import pending past the export timeout, then settles its reply', async () => {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    teardowns.push(
      serveWorkspaceArchive(9107, '/workspace', {
        reset: async (_target, prepare) => {
          markStarted();
          await gate;
          const plan = await prepare();
          if (plan.status === 'ready') await plan.mutate();
        },
      }),
    );
    const archive: WorkspaceArchiveV1 = {
      version: 1,
      root: '/workspace',
      files: [{ path: 'slow.txt', encoding: 'base64', content: btoa('late but exact') }],
    };
    const c = client(9107, 10);
    const mutation = c.import(JSON.stringify(archive));
    let outcome = 'pending';
    void mutation.then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );

    await started;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(outcome).toBe('pending');

    c.dispose();
    await Promise.resolve();
    expect(outcome).toBe('pending');
    release();
    await expect(mutation).resolves.toBeUndefined();
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/slow.txt'))).toBe(
      'late but exact',
    );
    await expect(c.import(JSON.stringify(archive))).rejects.toThrow(/disposed/i);
  });

  it('rejects an admitted import when the owner exit is certified', async () => {
    let ownerExited!: () => void;
    const ownerClosed = new Promise<void>((resolve) => {
      ownerExited = resolve;
    });
    bridge = bridgeWorkspaceArchive(9108, { timeoutMs: 10, ownerClosed });
    const mutation = bridge.import(
      JSON.stringify({ version: 1, root: '/workspace', files: [] } satisfies WorkspaceArchiveV1),
    );

    ownerExited();

    await expect(mutation).rejects.toThrow(/owner exited/i);
  });
});
