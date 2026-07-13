import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { viteCliModeFromEnv, viteCliPreparationFromEnv } from './vite-cli-prep.ts';

// node-entry-bootstrap.ts is a worker-only `kind:'url'` entry: top-level await
// + import-time side effects (reads the kernel process shim's argv, re-routes
// console, RUNS the entry) — importing it in node vitest executes a program
// run. Its mode decoding moved to vite-cli-prep.ts; the browser esbuild/Vite
// contract executes the real prepare call. Only unobservable spawn flags remain.
const source = readFileSync(
  fileURLToPath(new URL('./node-entry-bootstrap.ts', import.meta.url)),
  'utf8',
);

describe('vite CLI mode decoding (seam used by the node-entry bootstrap)', () => {
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

  it('builds one complete preparation with the exact inherited esbuild URL', () => {
    expect(
      viteCliPreparationFromEnv({
        root: '/parent',
        mode: 'build',
        executedBinPath: '/parent/node_modules/.bin/vite',
        esbuildWasmUrl: 'blob:host-esbuild-wasm',
      }),
    ).toEqual({
      root: '/parent',
      mode: 'build',
      executedBinPath: '/parent/node_modules/.bin/vite',
      esbuildWasmUrl: 'blob:host-esbuild-wasm',
    });
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
});
