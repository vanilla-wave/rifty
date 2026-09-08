import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const integrationRoot = dirname(fileURLToPath(import.meta.url));
const consumerRoot = resolve(integrationRoot, 'fixtures/workbench-vite-consumer');

const COPIED_RUNTIME_URLS = [
  'runtime/owner-worker.js',
  'runtime/kernel-worker.js',
  'runtime/node-worker.js',
  'runtime/dev-server-worker.js',
  'runtime/typescript-worker.js',
  'runtime/no-coi-toolchain-worker.js',
  'runtime/sw.js',
  'runtime/sqlite.wasm',
  'runtime/quickjs.wasm',
] as const;

describe('packed consumer uses copyable runtime assets', () => {
  it('compiles no Worker/SW entries and ships no builtin alias or QuickJS wrapper', () => {
    const main = readFileSync(resolve(consumerRoot, 'src/main.ts'), 'utf8');
    const viteConfig = readFileSync(resolve(consumerRoot, 'vite.config.ts'), 'utf8');
    expect(main).not.toMatch(/\?worker&url/);
    expect(main).not.toMatch(/\?url/);
    expect(main).not.toMatch(
      /@riftydev\/workbench\/(?:owner|kernel|node|dev-server|typescript|no-coi-toolchain)-worker/,
    );
    expect(main).not.toMatch(/@riftydev\/service-worker\/sw/);
    expect(viteConfig).not.toMatch(/host-builtins|hostBuiltinAliases/);
    expect(existsSync(resolve(consumerRoot, 'host-builtins.ts'))).toBe(false);
    expect(existsSync(resolve(consumerRoot, 'src/kernel-worker-entry.ts'))).toBe(false);
    for (const asset of COPIED_RUNTIME_URLS) {
      expect(main, asset).toContain(asset);
    }
  });
});
