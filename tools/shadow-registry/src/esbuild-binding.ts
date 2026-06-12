/**
 * Shadow-binding: vite's esbuild `transform` surface, routed to the real
 * esbuild WASI binary running on `@riftydev/runtime-wasi`.
 *
 * Background. Vite leans on esbuild for two jobs in dev: (1) per-module TS/JSX
 * transform (strip types, lower JSX) and (2) dependency pre-bundling. This
 * module wires job (1) — the hot path for every `.ts`/`.tsx`/`.jsx` import —
 * to `runWasi(esbuild.wasm, …)`. The previous `esbuildShimFiles` overlay was a
 * passthrough that returned source unchanged; this replaces the *transform*
 * call with a genuine esbuild run.
 *
 * Why this binary works (ADR-0047, supersedes ADR-0044 D1/D2): the vendored
 * `@esbuild/wasi-preview1` artifact imports ONLY `wasi_snapshot_preview1` — it
 * is a real WASIp1 binary, not the Go `js/wasm` (`gojs`) `esbuild-wasm` that
 * ADR-0044's audit inspected. ADR-0044 D3 (the gojs/Go-runtime bridge stays
 * deferred) remains valid and is now moot for esbuild specifically.
 *
 * Dependency injection. The caller passes its own `runWasi` (and the wasm
 * bytes) so this tool package does not take a hard dependency on
 * `@riftydev/runtime-wasi` — which would drag kernel/vfs into a data-table tool.
 * The structural `RunWasi` type below matches `@riftydev/runtime-wasi`'s export.
 *
 * Working directory (Q-2026-05-27-003 → ADR-0049). esbuild's Go/WASIp1 runtime
 * needs a cwd preopen even for a stdin transform (it canonicalises its working
 * directory at startup). We mount the workspace as the single preopen and name
 * it the `cwd`, so the cwd choice is explicit rather than dependent on object
 * key order. See ADR-0049 / `WasiOptions.cwd`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural shape of `@riftydev/runtime-wasi`'s `runWasi`. Declared locally so
 * this package carries no import edge to the WASI runtime (the consumer
 * injects the real function). The fields used here are a strict subset of
 * `WasiOptions`.
 */
export type RunWasi = (
  wasm: BufferSource,
  opts: {
    args?: string[];
    env?: Record<string, string>;
    preopens?: Record<string, string>;
    cwd?: string;
    stdout?: (chunk: string) => void;
    stderr?: (chunk: string) => void;
    stdin?: () => Uint8Array | null;
  },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/** Loader esbuild applies to the stdin source. The subset vite drives. */
export type EsbuildLoader = 'ts' | 'tsx' | 'jsx' | 'js';

export interface EsbuildTransformOptions {
  /** Source text to transform. Fed to esbuild over stdin. */
  source: string;
  /** Loader for the source (`ts` strips types, `jsx` lowers JSX, …). */
  loader: EsbuildLoader;
  /**
   * Guest working directory — mounted as the sole preopen and marked `cwd`.
   * Relative-path resolution inside the guest happens here. The directory must
   * already exist in the sync VFS mirror (the runner resolves preopens against
   * it). Defaults to `/workspace`.
   */
  workspace?: string;
  /** JSX transform mode passed through as `--jsx=<mode>` when set. */
  jsx?: 'transform' | 'preserve' | 'automatic';
  /** Output module format. Defaults to `esm` (vite's dev format). */
  format?: 'esm' | 'cjs' | 'iife';
  /** Source map mode passed through to esbuild when set. */
  sourcemap?: 'inline';
}

export interface EsbuildTransformResult {
  /** Transformed JavaScript. */
  code: string;
  /** esbuild warnings (stderr lines). Empty on a clean transform. */
  warnings: string[];
}

/**
 * Absolute path to the vendored esbuild WASI binary. Produced by
 * `scripts/fetch-esbuild-wasi.mjs` (build-time, not an npm dependency).
 */
export const ESBUILD_WASM_VENDOR_PATH: string = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'vendor',
  'esbuild-wasi-preview1',
  'esbuild.wasm',
);

/**
 * Read the vendored `esbuild.wasm` bytes. Throws a directed error if the
 * artifact is missing (the vendoring step has not run) — never a silent stub.
 */
export function loadVendoredEsbuildWasm(): Uint8Array {
  try {
    return readFileSync(ESBUILD_WASM_VENDOR_PATH);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `esbuild WASI binary not vendored at ${ESBUILD_WASM_VENDOR_PATH}. Run: node tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs (underlying: ${detail})`,
    );
  }
}

const enc = new TextEncoder();

/**
 * Transform `source` with the real esbuild WASI binary via the injected
 * `runWasi`. Returns the emitted JS. Throws if the guest exits non-zero
 * (syntax error, bad flags) — the error message carries esbuild's stderr so we
 * surface the failure rather than returning fake passthrough output.
 */
export async function transformWithEsbuild(
  runWasi: RunWasi,
  wasm: BufferSource,
  options: EsbuildTransformOptions,
): Promise<EsbuildTransformResult> {
  const workspace = options.workspace ?? '/workspace';
  const format = options.format ?? 'esm';
  const args = ['esbuild', `--loader=${options.loader}`, `--format=${format}`];
  if (options.jsx) args.push(`--jsx=${options.jsx}`);
  if (options.sourcemap) args.push(`--sourcemap=${options.sourcemap}`);

  const bytes = enc.encode(options.source);
  let delivered = false;
  const stderrChunks: string[] = [];

  const result = await runWasi(wasm, {
    args,
    env: {},
    preopens: { [workspace]: workspace },
    cwd: workspace,
    stderr: (c) => stderrChunks.push(c),
    // esbuild reads stdin in one go; deliver the whole buffer once, then EOF.
    stdin: () => {
      if (delivered) return null;
      delivered = true;
      return bytes;
    },
  });

  const stderr = stderrChunks.join('');
  if (result.exitCode !== 0) {
    throw new Error(
      `esbuild transform failed (exit ${result.exitCode}):\n${stderr || result.stderr}`,
    );
  }

  const warnings = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return { code: result.stdout, warnings };
}
