import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./node-entry-bootstrap.ts', import.meta.url)),
  'utf8',
);

describe('node-entry bootstrap server-capable bin path', () => {
  it('runs serve:true children with bin:true when RIFTY_BIN=1', () => {
    expect(source).toContain('RIFTY_NODE_SERVE');
    expect(source).toContain('bin: proc.env.RIFTY_BIN ===');
  });

  it('passes Vite CLI browser prep env into prepareViteCli', () => {
    expect(source).toContain('RIFTY_VITE_CLI_HMR');
    expect(source).toContain('RIFTY_VITE_CLI_PORT');
    expect(source).toContain('RIFTY_VITE_CLI_USER_CONFIG');
    expect(source).toContain('viteCliPrepareOptionsFromEnv(proc.env)');
  });

  it('forwards owner file-change messages into the active Vite CLI server', () => {
    expect(source).toContain('rifty:vite-file-change');
    expect(source).toContain('__riftyActiveViteServer');
    expect(source).toContain('invalidateViteModule');
  });
});
