import { NODE_ENTRY_BOOTSTRAP_PROTOCOL } from '@riftydev/runtime-js/builtins/node-entry-url';
import { describe, expect, it } from 'vitest';
import type { BinSpawnRequest } from '../glue/bin-executor.ts';
import {
  buildChildSpawnSpec,
  prepareOwnerChildBinSpawnRequest,
} from './owner-child-bin-executor.ts';

const NODE_WORKER_RUNTIME_ENV = {
  RIFTY_KERNEL_WORKER_URL: 'blob:kernel-url',
  RIFTY_NODE_ENTRY_WORKER_URL: 'blob:node-entry-url',
  RIFTY_SQLITE_WASM_URL: 'blob:sqlite-wasm',
  RIFTY_ESBUILD_WASM_URL: 'blob:esbuild-wasm',
};

describe('buildChildSpawnSpec', () => {
  it('keeps guest env exact and carries server-capable bin metadata beside the entry', () => {
    const req: BinSpawnRequest = {
      shimPath: '/workspace/node_modules/.bin/cowsay',
      args: ['hi'],
      env: {
        HOME: '/root',
        RIFTY_SQLITE_WASM_URL: 'user-poison',
        RIFTY_REMOTE_FS: 'user-poison',
        RIFTY_BIN: 'user-bin',
        RIFTY_NODE_SERVE: 'user-serve',
        RIFTY_PREVIEW_SCOPE: 'user-preview',
      },
      cwd: '/workspace',
      isTTY: true,
      cols: 120,
      rows: 40,
      previewScope: 'owner-preview',
    };
    const spec = buildChildSpawnSpec(req, 'blob:node-entry-url', NODE_WORKER_RUNTIME_ENV);
    expect(spec.entry).toEqual({
      kind: 'url',
      url: 'blob:node-entry-url',
      bootstrap: {
        protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
        payload: {
          hostRuntime: NODE_WORKER_RUNTIME_ENV,
          launch: {
            kind: 'program',
            bin: true,
            remoteFs: true,
            nodeServe: true,
            previewScope: 'owner-preview',
            terminal: {
              stdinIsTTY: false,
              stdoutIsTTY: true,
              stderrIsTTY: true,
              cols: 120,
              rows: 40,
            },
          },
        },
      },
    });
    expect(spec.argv).toEqual(['rifty', '/workspace/node_modules/.bin/cowsay', 'hi']);
    expect(spec.cwd).toBe('/workspace');
    expect(spec.env).toEqual(req.env);
    expect(spec.serve).toBe(true);
  });
});

describe('prepareOwnerChildBinSpawnRequest', () => {
  it('keeps mandatory Vite binding selection when the owner enriches preview metadata', () => {
    const request: BinSpawnRequest = {
      shimPath: '/workspace/node_modules/.bin/vite',
      args: ['dev'],
      env: { USER_VALUE: 'kept', NAPI_RS_FORCE_WASI: '0' },
      cwd: '/workspace',
      isTTY: false,
    };

    expect(
      prepareOwnerChildBinSpawnRequest(request, (prepared) => ({
        ...prepared,
        previewScope: prepared.previewScope ?? 'owner-preview',
      })),
    ).toMatchObject({
      env: { USER_VALUE: 'kept', NAPI_RS_FORCE_WASI: '1' },
      previewScope: expect.any(String),
    });
  });
});
