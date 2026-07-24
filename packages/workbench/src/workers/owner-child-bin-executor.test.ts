import { SHADOW_ASSET_PORT_CAPABILITY } from '@riftydev/npm-client/internal';
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
};
const REMOTE_FS_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';

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

  it('carries a private FS root out of band while bin argv/cwd stay public', () => {
    const req: BinSpawnRequest = {
      shimPath: '/node_modules/.bin/cowsay',
      args: ['hello'],
      env: { USER_VALUE: 'kept' },
      cwd: '/',
      isTTY: false,
      remoteFsRoot: REMOTE_FS_ROOT,
    };

    const spec = buildChildSpawnSpec(req, 'blob:node-entry-url', NODE_WORKER_RUNTIME_ENV);

    expect(spec.entry).toMatchObject({
      bootstrap: { payload: { launch: { remoteFsRoot: REMOTE_FS_ROOT } } },
    });
    expect(spec.argv).toEqual(['rifty', '/node_modules/.bin/cowsay', 'hello']);
    expect(spec.cwd).toBe('/');
    expect(spec.env).toEqual({ USER_VALUE: 'kept' });
    expect(JSON.stringify({ argv: spec.argv, cwd: spec.cwd, env: spec.env })).not.toContain(
      REMOTE_FS_ROOT,
    );
  });

  it('attaches admitted capabilities to the URL entry before spawn', () => {
    const capability = new MessageChannel();
    const req: BinSpawnRequest = {
      shimPath: '/node_modules/.bin/vite',
      args: ['build'],
      env: {},
      cwd: '/',
      isTTY: false,
    };

    const spec = buildChildSpawnSpec(req, 'blob:node-entry-url', NODE_WORKER_RUNTIME_ENV, {
      [SHADOW_ASSET_PORT_CAPABILITY]: capability.port2,
    });

    expect(spec.entry.kind).toBe('url');
    if (spec.entry.kind !== 'url') throw new Error('expected URL worker entry');
    expect(spec.entry.capabilityPorts?.[SHADOW_ASSET_PORT_CAPABILITY]).toBe(capability.port2);
    capability.port1.close();
    capability.port2.close();
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
