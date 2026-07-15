import { describe, expect, it } from 'vitest';
import type { BinSpawnRequest } from '../glue/bin-executor.ts';
import { buildChildSpawnSpec } from './owner-child-bin-executor.ts';

const NODE_WORKER_RUNTIME_ENV = {
  RIFTY_KERNEL_WORKER_URL: 'blob:kernel-url',
  RIFTY_NODE_ENTRY_WORKER_URL: 'blob:node-entry-url',
  RIFTY_SQLITE_WASM_URL: 'blob:sqlite-wasm',
  RIFTY_ESBUILD_WASM_URL: 'blob:esbuild-wasm',
};

describe('buildChildSpawnSpec', () => {
  it('maps a bin request to a server-capable node-entry spawn with remote-fs + bin flags', () => {
    const req: BinSpawnRequest = {
      shimPath: '/workspace/node_modules/.bin/cowsay',
      args: ['hi'],
      env: {
        HOME: '/root',
        RIFTY_SQLITE_WASM_URL: 'user-poison',
        RIFTY_REMOTE_FS: 'user-poison',
      },
      cwd: '/workspace',
      isTTY: true,
      cols: 120,
      rows: 40,
    };
    const spec = buildChildSpawnSpec(req, 'blob:node-entry-url', NODE_WORKER_RUNTIME_ENV);
    expect(spec.entry).toEqual({ kind: 'url', url: 'blob:node-entry-url' });
    expect(spec.argv).toEqual(['rifty', '/workspace/node_modules/.bin/cowsay', 'hi']);
    expect(spec.cwd).toBe('/workspace');
    expect(spec.env.RIFTY_REMOTE_FS).toBe('1');
    expect(spec.env.RIFTY_BIN).toBe('1');
    expect(spec.env.RIFTY_NODE_SERVE).toBe('1');
    expect(spec.env.RIFTY_STDIN_IS_TTY).toBe('0');
    expect(spec.env.RIFTY_STDOUT_IS_TTY).toBe('1');
    expect(spec.env.RIFTY_STDERR_IS_TTY).toBe('1');
    expect(spec.env.RIFTY_TTY_COLS).toBe('120');
    expect(spec.env.RIFTY_TTY_ROWS).toBe('40');
    expect(spec.env.HOME).toBe('/root');
    expect(spec.env.RIFTY_SQLITE_WASM_URL).toBe('blob:sqlite-wasm');
    expect(spec.serve).toBe(true);
  });
});
