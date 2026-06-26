/**
 * Browser-safe esbuild transform adapter. The caller injects the WASI runner
 * and wasm bytes; this module never imports Node builtins.
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

export type EsbuildLoader = 'ts' | 'tsx' | 'jsx' | 'js';

export interface EsbuildTransformOptions {
  readonly source: string;
  readonly loader: EsbuildLoader;
  readonly workspace?: string;
  readonly jsx?: 'transform' | 'preserve' | 'automatic';
  readonly format?: 'esm' | 'cjs' | 'iife';
  readonly target?: string;
  readonly minify?: boolean;
  readonly sourcemap?: 'inline' | 'external';
  readonly supported?: Readonly<Record<string, boolean>>;
}

export interface EsbuildTransformResult {
  readonly code: string;
  readonly warnings: string[];
  readonly map: string;
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const INLINE_MAP_MARKER = '//# sourceMappingURL=data:application/json;base64,';
const enc = new TextEncoder();

export async function transformWithEsbuild(
  runWasi: RunWasi,
  wasm: BufferSource,
  options: EsbuildTransformOptions,
): Promise<EsbuildTransformResult> {
  const workspace = options.workspace ?? '/workspace';
  const format = options.format ?? 'esm';
  const args = ['esbuild', `--loader=${options.loader}`, `--format=${format}`];
  if (options.jsx) args.push(`--jsx=${options.jsx}`);
  if (options.target) args.push(`--target=${options.target}`);
  if (options.minify) args.push('--minify');
  for (const [feature, enabled] of Object.entries(options.supported ?? {})) {
    args.push(`--supported:${feature}=${String(enabled)}`);
  }
  const wantExternalMap = options.sourcemap === 'external';
  if (options.sourcemap) args.push('--sourcemap=inline');

  const bytes = enc.encode(options.source);
  let delivered = false;
  const stderrChunks: string[] = [];

  const result = await runWasi(wasm, {
    args,
    env: {},
    preopens: { [workspace]: workspace },
    cwd: workspace,
    stderr: (c) => stderrChunks.push(c),
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

  if (!wantExternalMap) return { code: result.stdout, warnings, map: '' };

  const idx = result.stdout.indexOf(INLINE_MAP_MARKER);
  if (idx === -1) {
    throw new Error(
      'esbuild external sourcemap requested but no inline map was emitted by the guest',
    );
  }
  const map = base64ToUtf8(result.stdout.slice(idx + INLINE_MAP_MARKER.length).trim());
  const code = result.stdout.slice(0, idx).trimEnd();
  return { code, warnings, map };
}
