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
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOwnerVfsAuthorityComposition } from '../workers/owner-vfs-authority.ts';
import { installStampPath } from './install-stamp.ts';
import {
  type VfsFlushAckMessage,
  applyVfsWriteFrame,
  classifyVfsWriteFramePackageImpact,
  handleVfsFlushRequest,
  prepareVfsWriteFrame,
  sendGuardedVfsWrite,
  sendVfsWrite,
  serveVfsWrites,
  vfsWriteFrameTouchesPath,
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
  it('classifies manifest, guarded-tree, and ancestor mutations directionally', () => {
    expect(
      classifyVfsWriteFramePackageImpact(
        { type: 'write', path: '/workspace/package.json', data: enc.encode('{}') },
        '/workspace',
      ),
    ).toBe('manifest');
    // ADR-0307: strictly-inside-tree writes are extraneous.
    expect(
      classifyVfsWriteFramePackageImpact(
        { type: 'write', path: '/workspace/node_modules/pkg/index.js', data: enc.encode('x') },
        '/workspace',
      ),
    ).toBe('none');
    expect(
      classifyVfsWriteFramePackageImpact(
        {
          type: 'rm',
          path: '/workspace',
          recursive: true,
          force: true,
        },
        '/workspace',
      ),
    ).toBe('tree');
    expect(
      classifyVfsWriteFramePackageImpact(
        { type: 'rename', from: '/workspace', to: '/archive/workspace' },
        '/workspace',
      ),
    ).toBe('tree');
    expect(
      classifyVfsWriteFramePackageImpact(
        { type: 'copy', from: '/template', to: '/workspace' },
        '/workspace',
      ),
    ).toBe('tree');
    expect(
      classifyVfsWriteFramePackageImpact(
        { type: 'copy', from: '/workspace', to: '/archive/workspace' },
        '/workspace',
      ),
    ).toBe('none');
    expect(
      vfsWriteFrameTouchesPath(
        { type: 'rm', path: '/workspace', recursive: true, force: true },
        '/workspace/package.json',
      ),
    ).toBe(true);
  });

  it('preflights package no-ops and validation failures before a stamp transition', () => {
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/package.json',
      data: enc.encode('{"name":"current"}\n'),
    });

    expect(
      prepareVfsWriteFrame({
        type: 'write',
        path: '/workspace/package.json',
        data: enc.encode('{"name":"seed"}\n'),
        ifAbsent: true,
      }),
    ).toEqual({ status: 'noop' });
    expect(() =>
      prepareVfsWriteFrame({
        type: 'rename',
        from: '/workspace/missing',
        to: '/workspace/package.json',
      }),
    ).toThrow();
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/package.json'))).toBe(
      '{"name":"current"}\n',
    );
  });

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
    applyVfsWriteFrame({
      type: 'mkdir',
      path: '/workspace/lib',
      recursive: true,
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
    expect(changes).toEqual([['/workspace/src/old.js', '/workspace/lib/new.js']]);
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

  it('copies ordinary bytes while omitting owner install claims at every depth', () => {
    const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(
      new MemoryFsSync(),
      { ownerEpoch: 'page-copy-owner' },
    );
    setSyncMirror(authority);
    authority.mkdirSync('/workspace/src/nested/project', { recursive: true });
    authority.writeFileSync('/workspace/src/a.txt', enc.encode('a'));
    authority.writeFileSync('/workspace/src/nested/project/b.txt', enc.encode('b'));
    installStampClaims.write('/workspace/src', enc.encode('top claim'), { mkdirTree: true });
    installStampClaims.write('/workspace/src/nested/project', enc.encode('nested claim'), {
      mkdirTree: true,
    });

    applyVfsWriteFrame({
      type: 'copy',
      from: '/workspace/src',
      to: '/workspace/copy/src',
    });

    expect(dec.decode(authority.readFileBytesSync('/workspace/copy/src/a.txt'))).toBe('a');
    expect(
      dec.decode(authority.readFileBytesSync('/workspace/copy/src/nested/project/b.txt')),
    ).toBe('b');
    expect(authority.existsSync(installStampPath('/workspace/src'))).toBe(true);
    expect(authority.existsSync(installStampPath('/workspace/src/nested/project'))).toBe(true);
    expect(authority.existsSync(installStampPath('/workspace/copy/src'))).toBe(false);
    expect(authority.existsSync(installStampPath('/workspace/copy/src/nested/project'))).toBe(
      false,
    );
  });

  it('rejects an exact reserved batch endpoint before applying ordinary siblings', () => {
    const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(
      new MemoryFsSync(),
      { ownerEpoch: 'page-batch-owner' },
    );
    setSyncMirror(authority);
    authority.mkdirSync('/workspace', { recursive: true });
    const stamp = installStampPath('/workspace');
    installStampClaims.write('/workspace', enc.encode('authority claim'), { mkdirTree: true });

    expect(() =>
      applyVfsWriteFrame({
        type: 'batch',
        frames: [
          { type: 'write', path: '/workspace/ordinary.txt', data: enc.encode('ordinary') },
          { type: 'write', path: stamp, data: enc.encode('forged claim') },
        ],
      }),
    ).toThrow(/EPERM/);

    expect(authority.existsSync('/workspace/ordinary.txt')).toBe(false);
    expect(dec.decode(authority.readFileBytesSync(stamp))).toBe('authority claim');
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
    applyVfsWriteFrame({
      type: 'mkdir',
      path: '/workspace/moved',
      recursive: true,
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
    expect(changes).toEqual([
      ['/workspace/a.txt', '/workspace/moved/a.txt', '/workspace/b.txt', '/workspace/moved/b.txt'],
    ]);
  });

  it('preflights batch frames before applying any child mutation', () => {
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
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/moved/b.txt',
      data: enc.encode('existing'),
    });

    expect(() =>
      applyVfsWriteFrame(
        {
          type: 'batch',
          frames: [
            { type: 'rename', from: '/workspace/a.txt', to: '/workspace/moved/a.txt' },
            { type: 'rename', from: '/workspace/b.txt', to: '/workspace/moved/b.txt' },
          ],
        },
        { onWrite: (paths) => changes.push(paths) },
      ),
    ).toThrow(/already exists/);

    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/a.txt'))).toBe('a');
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/b.txt'))).toBe('b');
    expect(syncMirror().existsSync('/workspace/moved/a.txt')).toBe(false);
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/moved/b.txt'))).toBe('existing');
    expect(changes).toEqual([]);
  });

  it('rejects conflicting batch destinations before applying any child mutation', () => {
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
    applyVfsWriteFrame({
      type: 'mkdir',
      path: '/workspace/moved',
      recursive: true,
    });

    expect(() =>
      applyVfsWriteFrame(
        {
          type: 'batch',
          frames: [
            { type: 'rename', from: '/workspace/a.txt', to: '/workspace/moved/same.txt' },
            { type: 'rename', from: '/workspace/b.txt', to: '/workspace/moved/same.txt' },
          ],
        },
        { onWrite: (paths) => changes.push(paths) },
      ),
    ).toThrow(/batch path conflict/);

    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/a.txt'))).toBe('a');
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/b.txt'))).toBe('b');
    expect(syncMirror().existsSync('/workspace/moved/same.txt')).toBe(false);
    expect(changes).toEqual([]);
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

  it('write with ifAbsent seeds an absent file but never clobbers an existing one', () => {
    const changes: (readonly string[])[] = [];
    // Absent → seeds it (and notifies).
    applyVfsWriteFrame(
      { type: 'write', path: '/workspace/src/main.js', data: enc.encode('preset'), ifAbsent: true },
      { onWrite: (paths) => changes.push(paths) },
    );
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/src/main.js'))).toBe('preset');
    // A user edit (the persisted/restored state on reload).
    applyVfsWriteFrame({
      type: 'write',
      path: '/workspace/src/main.js',
      data: enc.encode('my edit'),
    });
    // Re-seed (mount/reload) with ifAbsent → present → skip, no clobber, no notify.
    applyVfsWriteFrame(
      { type: 'write', path: '/workspace/src/main.js', data: enc.encode('preset'), ifAbsent: true },
      { onWrite: (paths) => changes.push(paths) },
    );
    expect(dec.decode(syncMirror().readFileBytesSync('/workspace/src/main.js'))).toBe('my edit');
    expect(changes).toEqual([['/workspace/src/main.js']]); // only the first (absent) write notified
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

describe('handleVfsFlushRequest (durability barrier, ADR-0187)', () => {
  const collect = () => {
    const acks: VfsFlushAckMessage[] = [];
    return { acks, send: (m: VfsFlushAckMessage) => acks.push(m) };
  };

  it('acks ok when the drained ledger is clean (total 0)', async () => {
    const { acks, send } = collect();
    await handleVfsFlushRequest({
      opId: 'op-1',
      flush: async () => ({ failures: [], total: 0 }),
      send,
    });
    expect(acks).toEqual([{ type: 'rifty:vfs-flush-ack', opId: 'op-1', ok: true }]);
  });

  it('acks ok on the memory backend (no durability tier — flush returns undefined)', async () => {
    const { acks, send } = collect();
    await handleVfsFlushRequest({ opId: 'op-2', flush: async () => undefined, send });
    expect(acks).toEqual([{ type: 'rifty:vfs-flush-ack', opId: 'op-2', ok: true }]);
  });

  it('nacks with the failure sample when persist failures survive the drain', async () => {
    const { acks, send } = collect();
    await handleVfsFlushRequest({
      opId: 'op-3',
      flush: async () => ({
        failures: [{ path: '/scratch/a.txt', op: 'write' as const, message: 'quota exceeded' }],
        total: 2,
      }),
      send,
    });
    const [ack] = acks;
    if (!ack || ack.ok) throw new Error('expected a nack');
    expect(ack.opId).toBe('op-3');
    expect(ack.error.name).toBe('PersistFailureError');
    expect(ack.error.message).toContain('2 unhealed persist failure(s)');
    expect(ack.error.message).toContain('write /scratch/a.txt: quota exceeded');
  });

  it('nacks (never hangs the requester) when the drain itself throws', async () => {
    const { acks, send } = collect();
    await handleVfsFlushRequest({
      opId: 'op-4',
      flush: async () => {
        throw new Error('opfs root unavailable');
      },
      send,
    });
    const [ack] = acks;
    if (!ack || ack.ok) throw new Error('expected a nack');
    expect(ack.error.message).toBe('opfs root unavailable');
  });
});
