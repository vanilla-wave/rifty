import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { viteCliModeFromEnv, viteCliPrepareOptionsFromEnv } from './vite-cli-prep.ts';

// node-entry-bootstrap.ts is a worker-only `kind:'url'` entry: top-level await
// + import-time side effects (reads the kernel process shim's argv, re-routes
// console, RUNS the entry) — importing it in node vitest executes a program
// run. Its env→prepareViteCli decoding moved to vite-cli-prep.ts (importable
// seam) and is behavioral below; what remains greps are realm-wiring pins.
const source = readFileSync(
  fileURLToPath(new URL('./node-entry-bootstrap.ts', import.meta.url)),
  'utf8',
);

describe('vite CLI env decoding (seam used by the node-entry bootstrap)', () => {
  it('RIFTY_VITE_CLI_HMR_OFF=1 decodes to the hmrOff forcing and NOTHING else (ADR-0161)', () => {
    expect(viteCliPrepareOptionsFromEnv({ RIFTY_VITE_CLI_HMR_OFF: '1' })).toEqual({ hmrOff: true });
    expect(viteCliPrepareOptionsFromEnv({ RIFTY_VITE_CLI_HMR_OFF: '0' })).toEqual({});
    expect(viteCliPrepareOptionsFromEnv({})).toEqual({});
  });

  it('RIFTY_VITE_CLI_USER_CONFIG threads through as userConfigPath; empty means unset', () => {
    expect(viteCliPrepareOptionsFromEnv({ RIFTY_VITE_CLI_USER_CONFIG: 'vite.config.mts' })).toEqual(
      { userConfigPath: 'vite.config.mts' },
    );
    expect(viteCliPrepareOptionsFromEnv({ RIFTY_VITE_CLI_USER_CONFIG: '' })).toEqual({});
  });

  it('retired dev-server envs decode to nothing — no port forcing reaches prepareViteCli (ADR-0189)', () => {
    expect(
      viteCliPrepareOptionsFromEnv({
        RIFTY_VITE_CLI_PORT: '5299',
        RIFTY_VITE_CLI_HMR_OFF: '1',
        RIFTY_VITE_CLI_USER_CONFIG: 'c.mjs',
      }),
    ).toEqual({ hmrOff: true, userConfigPath: 'c.mjs' });
  });

  it('keeps existing canonical vite CLI modes active', () => {
    for (const mode of ['dev', 'build', 'preview'] as const) {
      expect(viteCliModeFromEnv(mode)).toBe(mode);
    }
  });

  it('keeps noncanonical vite CLI modes rejected', () => {
    expect(viteCliModeFromEnv('serve')).toBeNull();
    expect(viteCliModeFromEnv('')).toBeNull();
    expect(viteCliModeFromEnv(undefined)).toBeNull();
  });

  it('accepts optimize as a canonical vite CLI mode', () => {
    expect(viteCliModeFromEnv('optimize')).toBe('optimize');
  });

  it('accepts info as the canonical CAC no-action mode', () => {
    expect(viteCliModeFromEnv('info')).toBe('info');
  });

  it('rejects the legacy run vite CLI mode', () => {
    expect(viteCliModeFromEnv('run')).toBeNull();
  });
});

describe('node-entry bootstrap wiring (worker realm)', () => {
  it('runs serve:true children with bin:true when RIFTY_BIN=1', () => {
    // residual source pin: the serve-vs-run branch and the bin flag are read off
    // the kernel-installed `proc` at the entry's TOP LEVEL — observable only by
    // executing the entry in a kernel worker (browser-unit/e2e lane).
    expect(source).toContain('RIFTY_NODE_SERVE');
    expect(source).toContain('bin: proc.env.RIFTY_BIN ===');
  });

  it('threads proc.env through the decode seam into prepareViteCli at boot', () => {
    // residual source pin: the call happens in top-level await of the worker
    // entry; the decode itself is behavioral above.
    expect(source).toContain(
      'prepareViteCli(proc.cwd(), viteCliMode, entryPath, viteCliPrepareOptionsFromEnv(proc.env))',
    );
  });

  it('forwards owner file-change messages into the active Vite CLI server', () => {
    // residual source pin: proc.on('message') → __riftyActiveViteServer →
    // invalidateViteModule is fork-IPC wiring on the kernel process shim; node
    // has no such realm. The handle publication itself is behavioral in
    // vite-cli-prep.test.ts; invalidation in real-vite-invalidation.test.ts.
    expect(source).toContain('rifty:vite-file-change');
    expect(source).toContain('__riftyActiveViteServer');
    expect(source).toContain('invalidateViteModule');
  });
});
