/**
 * Integration: vite's TS/JSX transform surface, served by the REAL esbuild
 * WASI binary running through `@riftydev/runtime-wasi`'s `runWasi`.
 *
 * This is the M10 `Vite ↔ esbuild` shadow-binding acceptance (ADR-0047, which
 * reverses ADR-0044's swc substitution). Vite asks esbuild to strip TS types
 * and lower JSX on every module in dev; `@riftydev/shadow-registry` wires that
 * `transform` call to `runWasi(esbuild.wasm, …)` over a real workspace preopen.
 *
 * The binary is the build-time artifact vendored by
 * `tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs` — NOT an npm
 * dependency. If it is missing, run that script. The test skips (rather than
 * silently passing) when the artifact is absent so a clean checkout without the
 * vendoring step is loud about it.
 */
import { existsSync } from 'node:fs';
import { runWasi } from '@riftydev/runtime-wasi';
import {
  ESBUILD_WASM_VENDOR_PATH,
  loadVendoredEsbuildWasm,
  transformWithEsbuild,
} from '@riftydev/shadow-registry/esbuild-binding';
import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const haveWasm = existsSync(ESBUILD_WASM_VENDOR_PATH);
const maybe = haveWasm ? describe : describe.skip;

beforeEach(() => {
  resetSyncMirror();
  syncMirror().mkdirSync('/workspace', { recursive: true });
});
afterEach(() => {
  resetSyncMirror();
});

maybe('integration — esbuild WASI transform (shadow-binding)', () => {
  it('strips TypeScript types, emitting runnable ESM', async () => {
    const wasm = loadVendoredEsbuildWasm();
    const out = await transformWithEsbuild(runWasi, wasm, {
      source: [
        'const x: number = 1;',
        'export const greet = (name: string): string => `hi ${name}`;',
        'console.log(x);',
      ].join('\n'),
      loader: 'ts',
      workspace: '/workspace',
    });
    // Types are gone; values and exports survive.
    expect(out.code).toContain('const x = 1;');
    expect(out.code).toContain('const greet = (name) =>');
    expect(out.code).not.toMatch(/:\s*number/);
    expect(out.code).not.toMatch(/:\s*string/);
    expect(out.code).toContain('export {');
  });

  it('lowers JSX to the automatic runtime', async () => {
    const wasm = loadVendoredEsbuildWasm();
    const out = await transformWithEsbuild(runWasi, wasm, {
      source: 'export const App = () => <div className="x">hello</div>;\n',
      loader: 'jsx',
      jsx: 'automatic',
      workspace: '/workspace',
    });
    expect(out.code).toContain('jsx-runtime');
    expect(out.code).toContain('"div"');
    expect(out.code).toContain('className: "x"');
  });

  it('emits inline sourcemaps when requested', async () => {
    const wasm = loadVendoredEsbuildWasm();
    const out = await transformWithEsbuild(runWasi, wasm, {
      source: 'const x: number = 1;\nconsole.log(x);\n',
      loader: 'ts',
      sourcemap: 'inline',
      workspace: '/workspace',
    });
    expect(out.code).toContain('sourceMappingURL=data:application/json;base64');
  });

  it('surfaces a syntax error from the guest as a thrown error, not fake output', async () => {
    const wasm = loadVendoredEsbuildWasm();
    await expect(
      transformWithEsbuild(runWasi, wasm, {
        source: 'const = ;\n',
        loader: 'ts',
        workspace: '/workspace',
      }),
    ).rejects.toThrow(/esbuild/i);
  });
});
