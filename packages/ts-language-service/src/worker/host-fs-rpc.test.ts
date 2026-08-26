/**
 * `createRpcFsSync` over a FAKE `fs.*` sync-RPC `call` (ADR-0150 seam).
 *
 * The fake `call` serves an in-memory fixture by answering the EXACT owner-side
 * method names + return encodings from `runtime-js/src/ipc/fs-handlers.ts`:
 *   - fs.exists       → boolean
 *   - fs.readFileHead → binary total-size + first-chunk reply
 *   - fs.readdir      → VfsDirent[]
 *   - fs.readChunk    → Uint8Array (ranged subarray: offset .. offset+length)
 * so this asserts the adapter speaks the real contract, not a parallel one. The
 * second half drives the REAL `createTsLanguageService` end-to-end over the
 * adapter (a type error → the expected LSP diagnostic) — the unit under test is
 * the adapter + engine, mocked only at the unavoidable RPC boundary.
 */

import { FS_RPC_CHUNK } from '@riftydev/runtime-js';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { snapshotVfsFiles, writeRealWorkspaceTypeScript } from '../test-workspace-typescript.ts';
import { type FsRpcCallRecord, makeFakeFsCall } from './fs-rpc-test-helper.ts';
import { createRpcFsSync } from './host-fs-rpc.ts';

const enc = (s: string) => new TextEncoder().encode(s);

describe('createRpcFsSync over a fake fs.* call', () => {
  it('reads a small file back byte-for-byte (readFileBytesSync)', () => {
    const files = new Map([['/proj/a.ts', enc('const x = 1;\n')]]);
    const calls: FsRpcCallRecord[] = [];
    const fs = createRpcFsSync(makeFakeFsCall(files, calls));
    expect(fs.readFileBytesSync('/proj/a.ts')).toEqual(enc('const x = 1;\n'));
    expect(calls).toEqual([{ method: 'fs.readFileHead', payload: { path: '/proj/a.ts' } }]);
  });

  it('reassembles a multi-chunk file (> FS_RPC_CHUNK) correctly', () => {
    // 600 KiB > 256 KiB chunk → at least 3 readChunk round-trips, reassembled.
    const big = new Uint8Array(600 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const files = new Map([['/proj/big.bin', big]]);
    const calls: FsRpcCallRecord[] = [];
    const fs = createRpcFsSync(makeFakeFsCall(files, calls));
    const got = fs.readFileBytesSync('/proj/big.bin');
    expect(got.length).toBe(big.length);
    expect(got).toEqual(big);
    expect(calls).toEqual([
      { method: 'fs.readFileHead', payload: { path: '/proj/big.bin' } },
      {
        method: 'fs.readChunk',
        payload: { path: '/proj/big.bin', offset: FS_RPC_CHUNK, length: FS_RPC_CHUNK },
      },
      {
        method: 'fs.readChunk',
        payload: {
          path: '/proj/big.bin',
          offset: FS_RPC_CHUNK * 2,
          length: big.length - FS_RPC_CHUNK * 2,
        },
      },
    ]);
  });

  it('statSyncOrNull: file, dir, and null-on-missing', () => {
    const files = new Map([['/proj/a.ts', enc('x')]]);
    const fs = createRpcFsSync(makeFakeFsCall(files));
    expect(fs.statSyncOrNull('/proj/a.ts')).toMatchObject({ isFile: true, isDirectory: false });
    expect(fs.statSyncOrNull('/proj')).toMatchObject({ isFile: false, isDirectory: true });
    expect(fs.statSyncOrNull('/proj/missing.ts')).toBeNull();
  });

  it('existsSync reflects presence', () => {
    const fs = createRpcFsSync(makeFakeFsCall(new Map([['/proj/a.ts', enc('x')]])));
    expect(fs.existsSync('/proj/a.ts')).toBe(true);
    expect(fs.existsSync('/proj/nope.ts')).toBe(false);
  });

  it('readdirSync returns files and subdirs', () => {
    const files = new Map([
      ['/proj/a.ts', enc('x')],
      ['/proj/sub/b.ts', enc('y')],
    ]);
    const fs = createRpcFsSync(makeFakeFsCall(files));
    const entries = fs.readdirSync('/proj');
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['a.ts', 'sub']);
    expect(entries.find((e) => e.name === 'a.ts')?.isFile).toBe(true);
    expect(entries.find((e) => e.name === 'sub')?.isDirectory).toBe(true);
  });

  it('drives the real language service end-to-end: a type error → the expected LSP diagnostic', async () => {
    // Build the fixture in a memory FS, then serve its bytes over the fake RPC
    // call — proving the engine works over the RPC adapter exactly as over a
    // direct FsSync.
    const { fsSync: mem } = createMemoryFs();
    mem.mkdirSync('/proj', { recursive: true });
    mem.writeFileSync(
      '/proj/tsconfig.json',
      enc(JSON.stringify({ compilerOptions: { strict: true } })),
    );
    mem.writeFileSync('/proj/a.ts', enc('const x: number = "s";\n'));
    writeRealWorkspaceTypeScript(mem, '/proj');
    const files = snapshotVfsFiles(mem, '/proj');

    const { createTsLanguageService } = await import('../service.ts');
    const svc = await createTsLanguageService({
      fsSync: createRpcFsSync(makeFakeFsCall(files)),
      projectRoot: '/proj',
    });
    const diags = svc.getSemanticDiagnostics('/proj/a.ts');
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe(2322);
    expect(diags[0]?.message).toMatch(/not assignable/);
  });
});
