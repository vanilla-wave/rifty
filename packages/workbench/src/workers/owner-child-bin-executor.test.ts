import { describe, expect, it } from 'vitest';
import type { BinSpawnRequest } from '../glue/bin-executor.ts';
import { buildChildSpawnSpec } from './owner-child-bin-executor.ts';

describe('buildChildSpawnSpec', () => {
  it('maps a bin request to a server-capable node-entry spawn with remote-fs + bin flags', () => {
    const req: BinSpawnRequest = {
      shimPath: '/workspace/node_modules/.bin/cowsay',
      args: ['hi'],
      env: { HOME: '/root' },
      cwd: '/workspace',
      isTTY: true,
      cols: 132,
      rows: 43,
    };
    const spec = buildChildSpawnSpec(req, 'blob:node-entry-url', {
      sqliteWasmUrl: 'blob:sqlite',
      esbuildWasmUrl: 'blob:esbuild',
      kernelWorkerUrl: 'blob:kernel',
      nodeEntryWorkerUrl: 'blob:node',
    });
    expect(spec.entry).toEqual({ kind: 'url', url: 'blob:node-entry-url' });
    expect(spec.argv).toEqual(['rifty', '/workspace/node_modules/.bin/cowsay', 'hi']);
    expect(spec.cwd).toBe('/workspace');
    expect(spec.env.RIFTY_REMOTE_FS).toBe('1');
    expect(spec.env.RIFTY_BIN).toBe('1');
    expect(spec.env.RIFTY_NODE_SERVE).toBe('1');
    expect(spec.env.RIFTY_STDIN_IS_TTY).toBe('0');
    expect(spec.env.RIFTY_STDOUT_IS_TTY).toBe('1');
    expect(spec.env.RIFTY_STDERR_IS_TTY).toBe('1');
    expect(spec.env.RIFTY_TTY_COLS).toBe('132');
    expect(spec.env.RIFTY_TTY_ROWS).toBe('43');
    expect(spec.env.RIFTY_SQLITE_WASM_URL).toBe('blob:sqlite');
    expect(spec.env.RIFTY_ESBUILD_WASM_URL).toBe('blob:esbuild');
    expect(spec.env.RIFTY_KERNEL_WORKER_URL).toBe('blob:kernel');
    expect(spec.env.RIFTY_NODE_ENTRY_WORKER_URL).toBe('blob:node');
    expect(spec.env.HOME).toBe('/root');
    expect(spec.serve).toBe(true);
  });
});
