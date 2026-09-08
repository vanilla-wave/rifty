import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workbenchRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = resolve(workbenchRoot, 'dist/runtime');

const RUNTIME_SCRIPTS = [
  'owner-worker.js',
  'kernel-worker.js',
  'node-worker.js',
  'dev-server-worker.js',
  'typescript-worker.js',
  'no-coi-toolchain-worker.js',
  'sw.js',
] as const;

function scriptSource(name: string): string {
  const path = resolve(runtimeRoot, name);
  expect(existsSync(path), `copyable runtime asset ${name} is published`).toBe(true);
  return readFileSync(path, 'utf8');
}

describe('copyable Workbench runtime assets', () => {
  it('publishes a bundled runtime closure without @riftydev imports', () => {
    expect(existsSync(resolve(runtimeRoot, 'manifest.json'))).toBe(true);
    expect(existsSync(resolve(runtimeRoot, 'sqlite.wasm'))).toBe(true);
    expect(existsSync(resolve(runtimeRoot, 'quickjs.wasm'))).toBe(true);
    for (const file of RUNTIME_SCRIPTS) {
      const source = scriptSource(file);
      expect(source, file).not.toMatch(/from\s+['"]@riftydev\//);
      expect(source, file).not.toMatch(/import\s+['"]@riftydev\//);
    }
  });

  it('kernel asset publishes a sibling quickjs.wasm URL before guest start', () => {
    const kernel = scriptSource('kernel-worker.js');
    expect(kernel).toContain('quickjs.wasm');
    expect(kernel).toContain('__RIFTY_QUICKJS_WASM_URL');
  });

  it('rejects a runtime directory that omits a listed worker before guest start', () => {
    const manifest = JSON.parse(readFileSync(resolve(runtimeRoot, 'manifest.json'), 'utf8')) as {
      readonly files: readonly string[];
    };
    expect(manifest.files).toEqual(
      expect.arrayContaining([...RUNTIME_SCRIPTS, 'sqlite.wasm', 'quickjs.wasm']),
    );
    expect(existsSync(resolve(runtimeRoot, 'missing-owner-worker.js'))).toBe(false);
  });
});
