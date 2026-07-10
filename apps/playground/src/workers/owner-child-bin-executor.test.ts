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
    };
    const spec = buildChildSpawnSpec(req, 'blob:node-entry-url');
    expect(spec.entry).toEqual({ kind: 'url', url: 'blob:node-entry-url' });
    expect(spec.argv).toEqual(['rifty', '/workspace/node_modules/.bin/cowsay', 'hi']);
    expect(spec.cwd).toBe('/workspace');
    expect(spec.env.RIFTY_REMOTE_FS).toBe('1');
    expect(spec.env.RIFTY_BIN).toBe('1');
    expect(spec.env.RIFTY_NODE_SERVE).toBe('1');
    expect(spec.env.RIFTY_STDIN_IS_TTY).toBe('0');
    expect(spec.env.RIFTY_STDOUT_IS_TTY).toBe('1');
    expect(spec.env.RIFTY_STDERR_IS_TTY).toBe('1');
    expect(spec.env.HOME).toBe('/root');
    // rifty has no native bindings: force Rolldown/napi-rs onto WASI so a failed
    // load is LOUD, never a swallowed "Cannot find native binding" (Vite 8).
    expect(spec.env.NAPI_RS_FORCE_WASI).toBe('1');
    expect(spec.serve).toBe(true);
  });

  it('forwards recursive worker URLs so a foreground .bin/vite@8 can spawn Rolldown WASI workers', () => {
    const req: BinSpawnRequest = {
      shimPath: '/w/node_modules/.bin/vite',
      args: [],
      env: {},
      cwd: '/w',
      isTTY: false,
    };
    const spec = buildChildSpawnSpec(req, 'blob:node-entry', {
      kernelWorkerUrl: 'blob:kernel',
      nodeEntryWorkerUrl: 'blob:node-entry-2',
    });
    // Without these the Rolldown WASI pthread pool falls back to same-realm and
    // the dev server hangs past readiness (proof: manual-vite8-install e2e).
    expect(spec.env.RIFTY_KERNEL_WORKER_URL).toBe('blob:kernel');
    expect(spec.env.RIFTY_NODE_ENTRY_WORKER_URL).toBe('blob:node-entry-2');
  });

  it('a user-set NAPI_RS_FORCE_WASI survives into the spawn env (Node parity: user env wins)', () => {
    const spec = buildChildSpawnSpec(
      {
        shimPath: '/w/node_modules/.bin/vite',
        args: [],
        env: { NAPI_RS_FORCE_WASI: '0' },
        cwd: '/w',
        isTTY: false,
      },
      'blob:x',
    );
    // '1' is only the platform default; real Node never clobbers explicit user env.
    expect(spec.env.NAPI_RS_FORCE_WASI).toBe('0');
  });

  it('omits the worker URLs for non-recursive bins but still forces WASI', () => {
    const spec = buildChildSpawnSpec(
      { shimPath: '/w/.bin/eslint', args: [], env: {}, cwd: '/w', isTTY: false },
      'blob:x',
    );
    expect(spec.env.RIFTY_KERNEL_WORKER_URL).toBeUndefined();
    expect(spec.env.RIFTY_NODE_ENTRY_WORKER_URL).toBeUndefined();
    expect(spec.env.NAPI_RS_FORCE_WASI).toBe('1');
  });
});
