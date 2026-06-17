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

function serve(port: number, root = '/workspace'): void {
  teardowns.push(serveWorkspaceArchive(port, root));
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

  it('export rejects with a timeout when no owner is listening', async () => {
    await expect(client(9103, 50).export()).rejects.toThrow(/timeout/i);
  });
});
