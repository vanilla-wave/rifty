/**
 * Protocol endpoint over a REAL service (RPC-or-memory FsSync fixture). Drives
 * the endpoint with `ts:init`/`ts:open`/`ts:getSemanticDiagnostics`/`ts:update`/
 * … frames and asserts the response frames carry the right diagnostics and that
 * open/update flow works — the Node-testable core of the worker (no worker
 * globals, no kernel). The boundary is mocked only at the `fs.*` RPC seam (a
 * fake `call` serving an in-memory fixture, exactly as host-fs-rpc.test.ts).
 */

import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createRpcFsSync } from './host-fs-rpc.ts';
import type { TsDiagnosticsResponse } from './protocol.ts';
import { createServiceEndpoint } from './service-endpoint.ts';

const enc = (s: string) => new TextEncoder().encode(s);

/** Fake fs.* call serving `files` (path → bytes); mirrors the owner handlers. */
function makeFakeCall(files: Map<string, Uint8Array>): (m: string, p: unknown) => unknown {
  const dirs = new Set<string>(['/']);
  for (const path of files.keys()) {
    let d = path.slice(0, path.lastIndexOf('/')) || '/';
    while (d !== '/' && !dirs.has(d)) {
      dirs.add(d);
      d = d.slice(0, d.lastIndexOf('/')) || '/';
    }
  }
  const stat = (path: string) => {
    const b = files.get(path);
    if (b) return { isFile: true, isDirectory: false, size: b.length, mtime: 1 };
    if (dirs.has(path)) return { isFile: false, isDirectory: true, size: 0, mtime: 1 };
    return null;
  };
  return (method, payload) => {
    const p = payload as Record<string, unknown>;
    switch (method) {
      case 'fs.exists':
        return stat(p.path as string) !== null;
      case 'fs.statOrNull':
        return stat(p.path as string);
      case 'fs.readdir': {
        const dir = p.path as string;
        const prefix = dir === '/' ? '/' : `${dir}/`;
        const seen = new Map<string, { name: string; isFile: boolean; isDirectory: boolean }>();
        for (const fp of files.keys()) {
          if (!fp.startsWith(prefix)) continue;
          const rest = fp.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash === -1) seen.set(rest, { name: rest, isFile: true, isDirectory: false });
          else {
            const n = rest.slice(0, slash);
            if (!seen.has(n)) seen.set(n, { name: n, isFile: false, isDirectory: true });
          }
        }
        return [...seen.values()];
      }
      case 'fs.readChunk': {
        const b = files.get(p.path as string) ?? new Uint8Array(0);
        const offset = p.offset as number;
        const length = p.length as number;
        if (offset >= b.length) return new Uint8Array(0);
        return b.subarray(offset, Math.min(b.length, offset + length));
      }
      default:
        throw new Error(`fake fs.* call: unexpected method ${method}`);
    }
  };
}

function buildFixture(): Map<string, Uint8Array> {
  const { fsSync: mem } = createMemoryFs();
  mem.mkdirSync('/proj', { recursive: true });
  mem.writeFileSync(
    '/proj/tsconfig.json',
    enc(JSON.stringify({ compilerOptions: { strict: true } })),
  );
  mem.writeFileSync('/proj/a.ts', enc('export const x: number = 1;\n'));
  const files = new Map<string, Uint8Array>();
  for (const path of ['/proj/tsconfig.json', '/proj/a.ts'])
    files.set(path, mem.readFileBytesSync(path));
  return files;
}

function diags(r: Awaited<ReturnType<ReturnType<typeof createServiceEndpoint>['dispatch']>>) {
  expect(r.ok).toBe(true);
  expect(r.kind).toBe('diagnostics');
  return (r as TsDiagnosticsResponse).diagnostics;
}

describe('createServiceEndpoint', () => {
  it('init → query → open/update flow drives diagnostics through response frames', async () => {
    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeCall(buildFixture()),
    });

    // init
    const init = await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });
    expect(init).toEqual({ id: 1, ok: true, kind: 'ack' });

    // clean on disk
    const clean = await endpoint.dispatch({
      id: 2,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/a.ts',
    });
    expect(diags(clean)).toHaveLength(0);

    // open a buffer with a type error
    const open = await endpoint.dispatch({
      id: 3,
      type: 'ts:open',
      path: '/proj/a.ts',
      text: 'export const x: number = "bad";\n',
    });
    expect(open.ok).toBe(true);
    const withErr = await endpoint.dispatch({
      id: 4,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/a.ts',
    });
    const errs = diags(withErr);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.code).toBe(2322);

    // update fixes it
    await endpoint.dispatch({
      id: 5,
      type: 'ts:update',
      path: '/proj/a.ts',
      text: 'export const x: number = 2;\n',
    });
    const fixed = await endpoint.dispatch({
      id: 6,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/a.ts',
    });
    expect(diags(fixed)).toHaveLength(0);

    // close
    const close = await endpoint.dispatch({ id: 7, type: 'ts:close', path: '/proj/a.ts' });
    expect(close.ok).toBe(true);
  });

  it('syntactic diagnostics flow through the endpoint', async () => {
    const { fsSync: mem } = createMemoryFs();
    mem.mkdirSync('/proj', { recursive: true });
    mem.writeFileSync('/proj/bad.ts', enc('const x = ;\n'));
    const files = new Map([['/proj/bad.ts', mem.readFileBytesSync('/proj/bad.ts')]]);

    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeCall(files),
    });
    await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });
    const r = await endpoint.dispatch({
      id: 2,
      type: 'ts:getSyntacticDiagnostics',
      path: '/proj/bad.ts',
    });
    expect(diags(r).length).toBeGreaterThanOrEqual(1);
  });

  it('config-file diagnostics flow through the endpoint', async () => {
    const { fsSync: mem } = createMemoryFs();
    mem.mkdirSync('/proj', { recursive: true });
    mem.writeFileSync(
      '/proj/tsconfig.json',
      enc(JSON.stringify({ compilerOptions: { target: 'not-a-real-target' } })),
    );
    mem.writeFileSync('/proj/a.ts', enc('export const x = 1;\n'));
    const files = new Map<string, Uint8Array>();
    for (const p of ['/proj/tsconfig.json', '/proj/a.ts']) files.set(p, mem.readFileBytesSync(p));

    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeCall(files),
    });
    await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });
    const r = await endpoint.dispatch({ id: 2, type: 'ts:getConfigFileDiagnostics' });
    expect(diags(r).length).toBeGreaterThanOrEqual(1);
  });

  it('a query before init returns an error frame (not a silent empty)', async () => {
    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeCall(buildFixture()),
    });
    const r = await endpoint.dispatch({
      id: 1,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/a.ts',
    });
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('error');
  });
});
