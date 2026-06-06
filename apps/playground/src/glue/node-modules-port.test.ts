/**
 * Tests for the lazy node_modules remote-read bridge (ADR-0080).
 *
 * Like the sibling bridges (`vfs-write-port.test.ts`, `preview-port.test.ts`),
 * both ends run in the same Node realm here over distinct `BroadcastChannel`
 * instances keyed by the same port. Unlike the one-way write port, this is a
 * request/response protocol, so the tests `await` the returned promise directly
 * (no fixed-`tick()` timing — the promise settles when the reply arrives).
 */

import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NODE_MODULES_MAX_CONTENT_BYTES,
  type NodeModulesBridge,
  bridgeNodeModulesReads,
  serveNodeModulesReads,
} from './node-modules-port.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

const teardowns: Array<() => void> = [];
let bridge: NodeModulesBridge | null = null;

function serve(port: number): void {
  teardowns.push(serveNodeModulesReads(port));
}

function client(port: number, timeoutMs?: number): NodeModulesBridge {
  bridge = bridgeNodeModulesReads(port, timeoutMs === undefined ? {} : { timeoutMs });
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

/** Seed a fake worker node_modules tree. */
function seedViteTree(): void {
  const fs = syncMirror();
  fs.mkdirSync('/workspace/node_modules/vite/dist', { recursive: true });
  fs.mkdirSync('/workspace/src', { recursive: true });
  fs.writeFileSync('/workspace/node_modules/vite/package.json', enc.encode('{"name":"vite"}'));
  fs.writeFileSync('/workspace/src/main.js', enc.encode('console.log(1)'));
}

describe('node_modules read bridge', () => {
  it('round-trips a readdir: one level of entries, dirs before files, kind + size', async () => {
    seedViteTree();
    serve(8101);
    const entries = await client(8101).readdir('/workspace/node_modules/vite');

    expect(entries.map((e) => e.name)).toEqual(['dist', 'package.json']);
    expect(entries.find((e) => e.name === 'dist')?.kind).toBe('dir');
    const pkg = entries.find((e) => e.name === 'package.json');
    expect(pkg?.kind).toBe('file');
    expect(pkg?.size).toBeGreaterThan(0);
  });

  it('round-trips a readFile under the cap: content bytes survive the hop', async () => {
    seedViteTree();
    serve(8102);
    const res = await client(8102).readFile('/workspace/node_modules/vite/package.json');

    expect(res.size).toBe(15);
    expect(res.content).not.toBeNull();
    expect(dec.decode(res.content ?? new Uint8Array())).toBe('{"name":"vite"}');
  });

  it('replies content:null for a file over the cap (no silent empty read)', async () => {
    const fs = syncMirror();
    fs.mkdirSync('/workspace/node_modules/big', { recursive: true });
    const big = new Uint8Array(NODE_MODULES_MAX_CONTENT_BYTES + 10);
    fs.writeFileSync('/workspace/node_modules/big/huge.bin', big);
    serve(8103);

    const res = await client(8103).readFile('/workspace/node_modules/big/huge.bin');
    expect(res.size).toBeGreaterThan(NODE_MODULES_MAX_CONTENT_BYTES);
    expect(res.content).toBeNull();
  });

  it('refuses a path outside node_modules (scope guard)', async () => {
    seedViteTree();
    serve(8104);
    await expect(client(8104).readdir('/workspace/src')).rejects.toThrow(/node_modules/);
  });

  it('refuses a "../" traversal escaping node_modules', async () => {
    seedViteTree();
    serve(8105);
    // normalises to /workspace/src — outside node_modules → refused
    await expect(client(8105).readdir('/workspace/node_modules/../src')).rejects.toThrow(
      /node_modules/,
    );
  });

  it('surfaces an ENOENT readdir as a rejection carrying the worker message', async () => {
    seedViteTree();
    serve(8106);
    await expect(client(8106).readdir('/workspace/node_modules/does-not-exist')).rejects.toThrow(
      /ENOENT|no such/i,
    );
  });

  it('rejects with a timeout when no worker is listening', async () => {
    await expect(client(8107, 50).readdir('/workspace/node_modules/vite')).rejects.toThrow(
      /timeout/i,
    );
  });

  it('dispose() rejects in-flight reads and refuses subsequent ones', async () => {
    seedViteTree();
    // No serve on this port — the read stays in-flight until dispose rejects it.
    const c = client(8108, 5000);
    const inFlight = c.readdir('/workspace/node_modules/vite');
    c.dispose();
    await expect(inFlight).rejects.toThrow(/disposed/);
    await expect(c.readdir('/workspace/node_modules/vite')).rejects.toThrow(/disposed/);
    bridge = null; // already disposed; avoid double-dispose in afterEach
  });
});
