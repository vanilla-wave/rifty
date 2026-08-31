import { NODE_ENTRY_BOOTSTRAP_PROTOCOL } from '@riftydev/runtime-js/builtins/node-entry-url';
import { type BinExecutor, Shell } from '@riftydev/shell';
import { MemoryFsSync } from '@riftydev/vfs/internal';
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
const RUNTIME_BINDINGS = [
  {
    adapterId: 'rifty.runtime-adapter.esbuild.v1',
    packagePath: `${REMOTE_FS_ROOT}/node_modules/esbuild-wasm`,
  },
] as const;
const PUBLIC_RUNTIME_BINDINGS = [
  {
    adapterId: 'rifty.runtime-adapter.esbuild.v1',
    packagePath: '/node_modules/esbuild-wasm',
  },
] as const;

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

  it('marks an ordinary direct entry as bin:false while preserving argv', () => {
    const req: BinSpawnRequest = {
      shimPath: '/workspace/scripts/tool.mjs',
      args: ['first', 'second'],
      env: {},
      cwd: '/workspace',
      isTTY: false,
    };

    const spec = buildChildSpawnSpec(req, 'blob:node-entry-url', NODE_WORKER_RUNTIME_ENV);

    expect(spec.entry).toMatchObject({
      bootstrap: { payload: { launch: { kind: 'program', bin: false } } },
    });
    expect(spec.argv).toEqual(['rifty', '/workspace/scripts/tool.mjs', 'first', 'second']);
  });

  it('projects Shell direct-entry and bin resolutions into exact child launch modes', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/workspace/scripts/tool.mjs': 'console.log("ordinary entry");\n',
      '/workspace/node_modules/.bin/probe': 'console.log("bin shim");\n',
    });
    const specs: Array<ReturnType<typeof buildChildSpawnSpec>> = [];
    const execBin: BinExecutor = async (shimPath, args, ctx) => {
      const request: BinSpawnRequest = {
        shimPath,
        args,
        env: ctx.env,
        cwd: ctx.cwd,
        isTTY: ctx.isTTY === true,
        cols: ctx.cols,
        rows: ctx.rows,
      };
      specs.push(buildChildSpawnSpec(request, 'blob:node-entry-url', NODE_WORKER_RUNTIME_ENV));
      return 0;
    };
    const shell = new Shell({ cwd: '/workspace', fileSystem, execBin });

    const exitCodes = [
      (await shell.run('./scripts/tool.mjs direct')).exitCode,
      (await shell.run('./node_modules/.bin/probe explicit')).exitCode,
      (await shell.run('probe bare')).exitCode,
    ];

    expect(exitCodes).toEqual([0, 0, 0]);
    expect(specs).toMatchObject([
      {
        entry: { bootstrap: { payload: { launch: { kind: 'program', bin: false } } } },
        argv: ['rifty', '/workspace/scripts/tool.mjs', 'direct'],
      },
      {
        entry: { bootstrap: { payload: { launch: { kind: 'program', bin: true } } } },
        argv: ['rifty', '/workspace/node_modules/.bin/probe', 'explicit'],
      },
      {
        entry: { bootstrap: { payload: { launch: { kind: 'program', bin: true } } } },
        argv: ['rifty', '/workspace/node_modules/.bin/probe', 'bare'],
      },
    ]);
  });

  it('carries admitted runtime bindings in existing URL-entry metadata', () => {
    const req: BinSpawnRequest = {
      shimPath: '/node_modules/.bin/vite',
      args: ['build'],
      env: {},
      cwd: '/',
      isTTY: false,
      remoteFsRoot: REMOTE_FS_ROOT,
    };

    const spec = buildChildSpawnSpec(
      req,
      'blob:node-entry-url',
      NODE_WORKER_RUNTIME_ENV,
      RUNTIME_BINDINGS,
    );

    expect(spec.entry).toMatchObject({
      bootstrap: { payload: { launch: { runtimeBindings: PUBLIC_RUNTIME_BINDINGS } } },
    });
    expect(spec.argv).toEqual(['rifty', '/node_modules/.bin/vite', 'build']);
    expect(spec.env).toEqual({});
    expect(spec.cwd).toBe('/');
    expect(JSON.stringify({ argv: spec.argv, env: spec.env, cwd: spec.cwd })).not.toContain(
      REMOTE_FS_ROOT,
    );
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

  it('does not apply Vite policy to an ordinary direct entry named vite', () => {
    const request: BinSpawnRequest = {
      shimPath: '/workspace/scripts/vite',
      args: ['preview'],
      env: { NAPI_RS_FORCE_WASI: '0' },
      cwd: '/workspace',
      isTTY: false,
    };

    expect(prepareOwnerChildBinSpawnRequest(request)).toBe(request);
  });
});
