/**
 * Test-only real-world WASI forcing consumer (ADR-0316).
 *
 * The exact npm package supplies bytes to this conformance lane only. Product
 * code has no binding, checked-in blob, fetch script, alias, or browser path.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runWasi } from '@riftydev/runtime-wasi';
import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

function packagePaths(): { manifest: string; wasm: string } {
  const manifest = require.resolve('@esbuild/wasi-preview1/package.json');
  return { manifest, wasm: join(dirname(manifest), 'esbuild.wasm') };
}

function packageWasm(): Uint8Array {
  return readFileSync(packagePaths().wasm);
}

describe('@esbuild/wasi-preview1 test-only conformance consumer (ADR-0316)', () => {
  beforeEach(() => {
    resetSyncMirror();
    syncMirror().mkdirSync('/workspace', { recursive: true });
  });
  afterEach(() => resetSyncMirror());

  it('pins exact package version and imports only wasi_snapshot_preview1', async () => {
    const manifest = JSON.parse(readFileSync(packagePaths().manifest, 'utf8')) as {
      readonly version?: unknown;
    };
    expect(manifest.version).toBe('0.28.0');
    const mod = await WebAssembly.compile(packageWasm());
    const modules = new Set(WebAssembly.Module.imports(mod).map((entry) => entry.module));
    expect([...modules]).toEqual(['wasi_snapshot_preview1']);
  });

  it('runs the real CLI version surface through runWasi', async () => {
    const result = await runWasi(packageWasm(), {
      args: ['esbuild', '--version'],
      preopens: { '/workspace': '/workspace' },
      cwd: '/workspace',
    });
    expect(result).toEqual({ exitCode: 0, stdout: '0.28.0\n', stderr: '' });
  });

  it('reads TypeScript from stdin and emits transformed JavaScript', async () => {
    const input = new TextEncoder().encode('const answer: number = 42;\nexport { answer };\n');
    let read = false;
    const result = await runWasi(packageWasm(), {
      args: ['esbuild', '--loader=ts', '--format=esm', '--log-level=error'],
      preopens: { '/workspace': '/workspace' },
      cwd: '/workspace',
      stdin: () => {
        if (read) return null;
        read = true;
        return input;
      },
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('const answer = 42;');
    expect(result.stdout).not.toContain(': number');
    expect(result.stdout).toContain('export {');
  });
});
