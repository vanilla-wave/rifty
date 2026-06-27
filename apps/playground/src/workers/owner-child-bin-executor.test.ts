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
    expect(spec.serve).toBe(true);
  });
});
