/**
 * `createRpcFsSync` over a FAKE `fs.*` sync-RPC `call` (ADR-0150 seam).
 *
 * The fake `call` serves an in-memory fixture by answering the EXACT owner-side
 * method names + return encodings from `runtime-js/src/ipc/fs-handlers.ts`:
 *   - fs.exists       → boolean
 *   - fs.statOrNull   → { isFile, isDirectory, size?, mtime? } | null
 *   - fs.readdir      → VfsDirent[]
 *   - fs.readChunk    → Uint8Array (ranged subarray: offset .. offset+length)
 * so this asserts the adapter speaks the real contract, not a parallel one. The
 * second half drives the REAL `createTsLanguageService` end-to-end over the
 * adapter (a type error → the expected LSP diagnostic) — the unit under test is
 * the adapter + engine, mocked only at the unavoidable RPC boundary.
 */

import type { VfsDirent } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { FS_RPC_CHUNK } from '@riftydev/runtime-js';
import { describe, expect, it } from 'vitest';
import { snapshotVfsFiles, writeRealWorkspaceTypeScript } from '../test-workspace-typescript.ts';
import { createRpcFsSync } from './host-fs-rpc.ts';

interface StatShape {
  isFile: boolean;
  isDirectory: boolean;
  size?: number;
  mtime?: number;
}

/**
 * Build a fake sync-RPC `call` that serves `files` (path → bytes) and the
 * directory tree implied by their paths, mirroring the owner fs handlers. Throws
 * on an unknown method so a wrong method name fails loud (not silently null).
 */
function makeFakeCall(
  files: Map<string, Uint8Array>,
  calls: Array<{ method: string; payload: unknown }> = [],
): (method: string, payload: unknown) => unknown {
  const dirs = new Set<string>(['/']);
  for (const p of files.keys()) {
    let dir = p.slice(0, p.lastIndexOf('/')) || '/';
    while (dir !== '/' && !dirs.has(dir)) {
      dirs.add(dir);
      dir = dir.slice(0, dir.lastIndexOf('/')) || '/';
    }
    dirs.add(dir);
  }
  const statOf = (path: string): StatShape | null => {
    const bytes = files.get(path);
    if (bytes) return { isFile: true, isDirectory: false, size: bytes.length, mtime: 1 };
    if (dirs.has(path)) return { isFile: false, isDirectory: true, size: 0, mtime: 1 };
    return null;
  };
  return (method, payload) => {
    calls.push({ method, payload });
    const p = payload as Record<string, unknown>;
    switch (method) {
      case 'fs.exists':
        return statOf(p.path as string) !== null;
      case 'fs.statOrNull':
        return statOf(p.path as string);
      case 'fs.stat': {
        const s = statOf(p.path as string);
        if (s === null) throw new Error(`ENOENT: ${p.path as string}`);
        return s;
      }
      case 'fs.readdir': {
        const dir = p.path as string;
        const prefix = dir === '/' ? '/' : `${dir}/`;
        const seen = new Map<string, VfsDirent>();
        for (const fp of files.keys()) {
          if (!fp.startsWith(prefix)) continue;
          const rest = fp.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash === -1) seen.set(rest, { name: rest, isFile: true, isDirectory: false });
          else {
            const name = rest.slice(0, slash);
            if (!seen.has(name)) seen.set(name, { name, isFile: false, isDirectory: true });
          }
        }
        return [...seen.values()];
      }
      case 'fs.readChunk': {
        const bytes = files.get(p.path as string) ?? new Uint8Array(0);
        const offset = p.offset as number;
        const length = p.length as number;
        if (offset >= bytes.length) return new Uint8Array(0);
        // Ranged subarray — exactly the owner handler's reply shape.
        return bytes.subarray(offset, Math.min(bytes.length, offset + length));
      }
      case 'fs.readFileHead': {
        const bytes = files.get(p.path as string) ?? new Uint8Array(0);
        const first = bytes.subarray(0, FS_RPC_CHUNK);
        const reply = new Uint8Array(8 + first.length);
        new DataView(reply.buffer).setFloat64(0, bytes.length, true);
        reply.set(first, 8);
        return reply;
      }
      default:
        throw new Error(`fake fs.* call: unexpected method ${method}`);
    }
  };
}

const enc = (s: string) => new TextEncoder().encode(s);

describe('createRpcFsSync over a fake fs.* call', () => {
  it('reads a small file back byte-for-byte (readFileBytesSync)', () => {
    const files = new Map([['/proj/a.ts', enc('const x = 1;\n')]]);
    const calls: Array<{ method: string; payload: unknown }> = [];
    const fs = createRpcFsSync(makeFakeCall(files, calls));
    expect(fs.readFileBytesSync('/proj/a.ts')).toEqual(enc('const x = 1;\n'));
    expect(calls).toEqual([{ method: 'fs.readFileHead', payload: { path: '/proj/a.ts' } }]);
  });

  it('reassembles a multi-chunk file (> FS_RPC_CHUNK) correctly', () => {
    // 600 KiB > 256 KiB chunk → at least 3 readChunk round-trips, reassembled.
    const big = new Uint8Array(600 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const files = new Map([['/proj/big.bin', big]]);
    const calls: Array<{ method: string; payload: unknown }> = [];
    const fs = createRpcFsSync(makeFakeCall(files, calls));
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
    const fs = createRpcFsSync(makeFakeCall(files));
    expect(fs.statSyncOrNull('/proj/a.ts')).toMatchObject({ isFile: true, isDirectory: false });
    expect(fs.statSyncOrNull('/proj')).toMatchObject({ isFile: false, isDirectory: true });
    expect(fs.statSyncOrNull('/proj/missing.ts')).toBeNull();
  });

  it('existsSync reflects presence', () => {
    const fs = createRpcFsSync(makeFakeCall(new Map([['/proj/a.ts', enc('x')]])));
    expect(fs.existsSync('/proj/a.ts')).toBe(true);
    expect(fs.existsSync('/proj/nope.ts')).toBe(false);
  });

  it('readdirSync returns files and subdirs', () => {
    const files = new Map([
      ['/proj/a.ts', enc('x')],
      ['/proj/sub/b.ts', enc('y')],
    ]);
    const fs = createRpcFsSync(makeFakeCall(files));
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
      fsSync: createRpcFsSync(makeFakeCall(files)),
      projectRoot: '/proj',
    });
    const diags = svc.getSemanticDiagnostics('/proj/a.ts');
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe(2322);
    expect(diags[0]?.message).toMatch(/not assignable/);
  });
});
