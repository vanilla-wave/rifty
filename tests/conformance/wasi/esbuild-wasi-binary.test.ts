/**
 * Conformance guard for the vendored esbuild WASI binary (ADR-0047).
 *
 * Two invariants the ADR-0047 reversal rests on, codified so a future shim
 * regression or a bad re-vendor is caught:
 *
 *   1. `esbuild.wasm` imports ONLY `wasi_snapshot_preview1` — it is a real
 *      WASIp1 binary, NOT the Go `js/wasm` (`gojs`) `esbuild-wasm` that
 *      ADR-0044 wrongly assumed was the only published build. If a future
 *      bump reintroduced a gojs/wbindgen import, `@riftydev/runtime-wasi` could
 *      not host it and this test fails loudly.
 *   2. It runs end-to-end through `runWasi` — `esbuild --version` exits 0 and
 *      prints the version. This exercises args/environ/fd_write/proc_exit and
 *      the preopen/cwd path (ADR-0049).
 *
 * The binary is a build-time artifact (`tools/shadow-registry/scripts/
 * fetch-esbuild-wasi.mjs`), not an npm dependency. The suite skips — rather
 * than silently passing — when the artifact is absent so a clean checkout
 * without the vendoring step is loud about it.
 */
import { existsSync } from 'node:fs';
import { runWasi } from '@riftydev/runtime-wasi';
import {
  ESBUILD_WASM_VENDOR_PATH,
  loadVendoredEsbuildWasm,
} from '@riftydev/shadow-registry/esbuild-binding';
import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const maybe = existsSync(ESBUILD_WASM_VENDOR_PATH) ? describe : describe.skip;

maybe('esbuild WASI binary (ADR-0047)', () => {
  beforeEach(() => {
    resetSyncMirror();
    syncMirror().mkdirSync('/workspace', { recursive: true });
  });
  afterEach(() => resetSyncMirror());

  it('imports only wasi_snapshot_preview1 (no gojs / wbindgen)', async () => {
    const wasm = loadVendoredEsbuildWasm();
    const mod = await WebAssembly.compile(wasm);
    const modules = new Set(WebAssembly.Module.imports(mod).map((i) => i.module));
    expect([...modules]).toEqual(['wasi_snapshot_preview1']);
  });

  it('runs `esbuild --version` through runWasi (exit 0)', async () => {
    const wasm = loadVendoredEsbuildWasm();
    const res = await runWasi(wasm, {
      args: ['esbuild', '--version'],
      preopens: { '/workspace': '/workspace' },
      cwd: '/workspace',
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
