/**
 * Tests for the VFS write port (ADR-0043 / D4).
 *
 * The page side calls `sendVfsWrite(port, frame)` from the editor; the
 * worker side runs `serveVfsWrites(port)` which applies each frame to the
 * realm-local `syncMirror()`. Both ends run in the same Node realm here
 * over distinct `BroadcastChannel` instances — the same pattern the
 * preview-port unit tests use.
 *
 * One-way only: edits flow page → worker. Two-way sync is out of scope
 * until OPFS-as-sync is shared across realms (M12+).
 */

import { syncMirror } from '@rifty/vfs';
import { resetSyncMirror } from '@rifty/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendVfsWrite, serveVfsWrites } from './vfs-write-port.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

let teardown: (() => void) | null = null;

beforeEach(() => {
  resetSyncMirror();
});

afterEach(() => {
  teardown?.();
  teardown = null;
});

async function tick(ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('serveVfsWrites + sendVfsWrite', () => {
  it('applies a write frame to the worker-side syncMirror', async () => {
    teardown = serveVfsWrites(7001);

    sendVfsWrite(7001, {
      type: 'write',
      path: '/workspace/src/main.js',
      data: enc.encode('console.log("hello from page")'),
    });

    await tick();

    expect(syncMirror().existsSync('/workspace/src/main.js')).toBe(true);
    const bytes = syncMirror().readFileBytesSync('/workspace/src/main.js');
    expect(dec.decode(bytes)).toBe('console.log("hello from page")');
  });

  it('applies a mkdir frame recursively', async () => {
    teardown = serveVfsWrites(7002);

    sendVfsWrite(7002, {
      type: 'mkdir',
      path: '/workspace/deeply/nested/dir',
      recursive: true,
    });

    await tick();

    expect(syncMirror().statSync('/workspace/deeply/nested/dir').isDirectory).toBe(true);
  });

  it('subsequent writes overwrite the prior content', async () => {
    teardown = serveVfsWrites(7003);

    sendVfsWrite(7003, {
      type: 'write',
      path: '/workspace/x.js',
      data: enc.encode('first'),
    });
    await tick();
    sendVfsWrite(7003, {
      type: 'write',
      path: '/workspace/x.js',
      data: enc.encode('second'),
    });
    await tick();

    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/x.js'))).toBe('second');
  });

  it('teardown stops processing further frames', async () => {
    teardown = serveVfsWrites(7004);

    sendVfsWrite(7004, {
      type: 'write',
      path: '/workspace/a.js',
      data: enc.encode('one'),
    });
    await tick();
    expect(syncMirror().existsSync('/workspace/a.js')).toBe(true);

    teardown();
    teardown = null;

    sendVfsWrite(7004, {
      type: 'write',
      path: '/workspace/b.js',
      data: enc.encode('two'),
    });
    await tick();
    expect(syncMirror().existsSync('/workspace/b.js')).toBe(false);
  });

  it('creates parent directories on write (the editor never mkdir-s explicitly)', async () => {
    teardown = serveVfsWrites(7005);

    sendVfsWrite(7005, {
      type: 'write',
      path: '/workspace/new/path/file.js',
      data: enc.encode('x'),
    });
    await tick();

    expect(syncMirror().existsSync('/workspace/new/path/file.js')).toBe(true);
  });
});
