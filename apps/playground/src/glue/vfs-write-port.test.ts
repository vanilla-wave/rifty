/**
 * Tests for the VFS write port (ADR-0043 / D4).
 *
 * The page side calls `sendVfsWrite(port, frame)` from the editor; the
 * worker side runs `serveVfsWrites(port)` which applies each frame to the
 * realm-local `syncMirror()`. Both ends run in the same Node realm here
 * over distinct `BroadcastChannel` instances - the same pattern the
 * preview-port unit tests use.
 *
 * One-way only: edits flow page -> worker. Two-way sync is out of scope
 * until OPFS-as-sync is shared across realms (M12+).
 */

import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyVfsWriteFrame,
  sendGuardedVfsWrite,
  sendVfsWrite,
  serveVfsWrites,
} from './vfs-write-port.ts';

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

  it('applies an rm frame (explorer delete/rename → worker, ADR-0076)', async () => {
    teardown = serveVfsWrites(7007);

    sendVfsWrite(7007, { type: 'write', path: '/workspace/src/gone.js', data: enc.encode('x') });
    await tick();
    expect(syncMirror().existsSync('/workspace/src/gone.js')).toBe(true);

    sendVfsWrite(7007, {
      type: 'rm',
      path: '/workspace/src/gone.js',
      recursive: false,
      force: true,
    });
    await tick();

    expect(syncMirror().existsSync('/workspace/src/gone.js')).toBe(false);
  });

  it('applies a rename frame as one owner-side mutation', () => {
    const changes: (readonly string[])[] = [];
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/src/old.js',
      data: enc.encode('old'),
    });

    applyVfsWriteFrame(
      {
        type: 'rename',
        from: '/workspace/src/old.js',
        to: '/workspace/lib/new.js',
      },
      { onWrite: (paths) => changes.push(paths) },
    );

    expect(syncMirror().existsSync('/workspace/src/old.js')).toBe(false);
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/lib/new.js'))).toBe('old');
    expect(changes).toEqual([['/workspace/lib/new.js']]);
  });

  it('refuses rename collisions instead of silently overwriting', () => {
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/a.js',
      data: enc.encode('a'),
    });
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/b.js',
      data: enc.encode('b'),
    });

    expect(() =>
      applyVfsWriteFrame({
        type: 'rename',
        from: '/workspace/a.js',
        to: '/workspace/b.js',
      }),
    ).toThrow(/already exists/);
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/a.js'))).toBe('a');
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/b.js'))).toBe('b');
  });

  it('rejects rename into the source subtree before creating the destination', () => {
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/src/a.js',
      data: enc.encode('a'),
    });

    expect(() =>
      applyVfsWriteFrame({
        type: 'rename',
        from: '/workspace/src',
        to: '/workspace/src/new',
      }),
    ).toThrow(/EINVAL/);
    expect(syncMirror().existsSync('/workspace/src/a.js')).toBe(true);
    expect(syncMirror().existsSync('/workspace/src/new')).toBe(false);
  });

  it('applies a recursive copy frame without removing the source', () => {
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/src/a.js',
      data: enc.encode('a'),
    });
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/src/nested/b.js',
      data: enc.encode('b'),
    });

    applyVfsWriteFrame({
      type: 'copy',
      from: '/workspace/src',
      to: '/workspace/copy/src',
    });

    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/src/a.js'))).toBe('a');
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/copy/src/a.js'))).toBe('a');
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/copy/src/nested/b.js'))).toBe('b');
  });

  it('applies a batch frame as one coalesced owner mutation notification', () => {
    const changes: (readonly string[])[] = [];
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/a.txt',
      data: enc.encode('a'),
    });
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/b.txt',
      data: enc.encode('b'),
    });

    applyVfsWriteFrame(
      {
        type: 'batch',
        frames: [
          { type: 'rename', from: '/workspace/a.txt', to: '/workspace/moved/a.txt' },
          { type: 'rename', from: '/workspace/b.txt', to: '/workspace/moved/b.txt' },
        ],
      },
      { onWrite: (paths) => changes.push(paths) },
    );

    expect(syncMirror().existsSync('/workspace/a.txt')).toBe(false);
    expect(syncMirror().existsSync('/workspace/b.txt')).toBe(false);
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/moved/a.txt'))).toBe('a');
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/moved/b.txt'))).toBe('b');
    expect(changes).toEqual([['/workspace/moved/a.txt', '/workspace/moved/b.txt']]);
  });

  it('rejects copy into the source subtree before creating the destination', () => {
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/src/a.js',
      data: enc.encode('a'),
    });

    expect(() =>
      applyVfsWriteFrame({
        type: 'copy',
        from: '/workspace/src',
        to: '/workspace/src/new',
      }),
    ).toThrow(/EINVAL/);
    expect(syncMirror().existsSync('/workspace/src/a.js')).toBe(true);
    expect(syncMirror().existsSync('/workspace/src/new')).toBe(false);
  });

  it('rm frame removes a directory subtree recursively', async () => {
    teardown = serveVfsWrites(7008);

    sendVfsWrite(7008, { type: 'write', path: '/workspace/d/a.js', data: enc.encode('a') });
    await tick();
    sendVfsWrite(7008, { type: 'rm', path: '/workspace/d', recursive: true, force: true });
    await tick();

    expect(syncMirror().existsSync('/workspace/d')).toBe(false);
    expect(syncMirror().existsSync('/workspace/d/a.js')).toBe(false);
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

  it('can require an existing parent for owner-routed create-file frames', () => {
    expect(() =>
      applyVfsWriteFrame({
        type: 'write',
        path: '/workspace/missing/file.js',
        data: enc.encode('x'),
        recursive: false,
      }),
    ).toThrow(/ENOENT/);
    expect(syncMirror().existsSync('/workspace/missing/file.js')).toBe(false);
  });

  it('rm force=false is loud for stale-snapshot deletes of missing owner paths', () => {
    expect(() =>
      applyVfsWriteFrame({
        type: 'rm',
        path: '/workspace/missing.js',
        recursive: true,
        force: false,
      }),
    ).toThrow(/ENOENT/);
  });

  it('guarded owner send rejects after owner exit instead of falling back to a drop-prone channel', () => {
    const sent: unknown[] = [];
    const fallback: unknown[] = [];

    expect(() =>
      sendGuardedVfsWrite({
        key: 7010,
        exited: true,
        frame: {
          type: 'rename',
          from: '/workspace/src/a.js',
          to: '/workspace/src/b.js',
        },
        sendIpc: (message) => {
          sent.push(message);
          return true;
        },
        fallback: (key, frame) => fallback.push({ key, frame }),
      }),
    ).toThrow(/workspace owner has exited/);

    expect(sent).toEqual([]);
    expect(fallback).toEqual([]);
  });

  it('applies a write frame without requiring BroadcastChannel transport', () => {
    const changes: (readonly string[])[] = [];

    applyVfsWriteFrame(
      {
        type: 'write',
        path: '/workspace/ipc/main.js',
        data: enc.encode('from ipc'),
      },
      { onWrite: (paths) => changes.push(paths) },
    );

    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/ipc/main.js'))).toBe('from ipc');
    expect(changes).toEqual([['/workspace/ipc/main.js']]);
  });

  it('notifies after applying write and mkdir frames', async () => {
    const changes: (readonly string[])[] = [];
    teardown = serveVfsWrites(7006, {
      onWrite: (paths) => changes.push(paths),
    });

    sendVfsWrite(7006, {
      type: 'mkdir',
      path: '/workspace/src',
      recursive: true,
    });
    sendVfsWrite(7006, {
      type: 'write',
      path: '/workspace/src/extra.js',
      data: enc.encode('export const ok = true;'),
    });
    await tick();

    expect(changes).toEqual([['/workspace/src'], ['/workspace/src/extra.js']]);
  });
});
