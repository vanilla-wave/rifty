import { runWasi } from '@riftydev/runtime-wasi/wasi';
import { NotImplementedError } from '@riftydev/vfs';

interface EsbuildTransformOptions {
  readonly loader?: string;
  readonly format?: string;
  readonly jsx?: string;
  readonly jsxFactory?: string;
  readonly jsxFragment?: string;
  readonly jsxImportSource?: string;
  readonly jsxDev?: boolean;
  readonly platform?: string;
  readonly target?: string | readonly string[];
  readonly sourcemap?: boolean | 'inline' | 'external' | 'both';
  readonly sourcefile?: string;
  readonly tsconfigRaw?: string | object;
  readonly supported?: Readonly<Record<string, boolean>>;
  readonly define?: Readonly<Record<string, string>>;
  readonly charset?: string;
  readonly legalComments?: string;
  readonly keepNames?: boolean;
  readonly logLevel?: string;
  readonly logLimit?: number;
  readonly minify?: boolean;
  readonly minifyIdentifiers?: boolean;
  readonly minifySyntax?: boolean;
  readonly minifyWhitespace?: boolean;
  readonly treeShaking?: boolean;
}

interface EsbuildTransformResult {
  readonly code: string;
  readonly map: string;
  readonly warnings: readonly unknown[];
}

export type EsbuildTransformBridge = (
  input: string | Uint8Array,
  options?: EsbuildTransformOptions,
) => Promise<EsbuildTransformResult>;

declare global {
  var __riftyEsbuildTransform: EsbuildTransformBridge | undefined;
}

const dec = new TextDecoder();
const enc = new TextEncoder();
const INLINE_SOURCEMAP =
  /\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z0-9+/=]+)\s*$/;

let wasmModulePromise: Promise<WebAssembly.Module> | null = null;
let esbuildWasmUrl: string | null = null;

export function configureEsbuildWasmUrl(url: string): void {
  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('workbench esbuildWasmUrl is required');
  }
  if (esbuildWasmUrl !== null && esbuildWasmUrl !== url) {
    throw new Error('workbench esbuildWasmUrl cannot change after worker initialization');
  }
  esbuildWasmUrl = url;
}
const SUPPORTED_OPTIONS = new Set([
  'charset',
  'define',
  'format',
  'jsx',
  'jsxDev',
  'jsxFactory',
  'jsxFragment',
  'jsxImportSource',
  'keepNames',
  'legalComments',
  'loader',
  'logLevel',
  'logLimit',
  'minify',
  'minifyIdentifiers',
  'minifySyntax',
  'minifyWhitespace',
  'platform',
  'sourcemap',
  'sourcefile',
  'supported',
  'target',
  'treeShaking',
  'tsconfigRaw',
]);

function sourceText(input: string | Uint8Array): string {
  return typeof input === 'string' ? input : dec.decode(input);
}

/** Compile esbuild.wasm ONCE per realm and reuse the Module across transforms —
 * a fresh WASI instance per run keeps process semantics, but re-compiling the
 * ~19 MB binary per transform dominated dev-server transform latency. */
async function loadEsbuildModule(): Promise<WebAssembly.Module> {
  if (esbuildWasmUrl === null) {
    throw new Error('workbench esbuildWasmUrl was not configured');
  }
  wasmModulePromise ??= fetch(esbuildWasmUrl).then(async (response) => {
    if (!response.ok) {
      throw new Error(`esbuild WASI fetch failed: HTTP ${response.status}`);
    }
    return WebAssembly.compile(await response.arrayBuffer());
  });
  return wasmModulePromise;
}

function pushStringOption(args: string[], flag: string, value: unknown): void {
  if (typeof value === 'string' && value.length > 0) args.push(`${flag}=${value}`);
}

function pushNumberOption(args: string[], flag: string, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) args.push(`${flag}=${value}`);
}

function pushBooleanOption(args: string[], flag: string, value: unknown): void {
  if (typeof value === 'boolean') args.push(`${flag}=${String(value)}`);
}

function pushBooleanFlag(args: string[], flag: string, value: unknown): void {
  if (value === true) args.push(flag);
}

function assertStringRecord(
  feature: string,
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`esbuild transform option '${feature}' must be an object`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new TypeError(`esbuild transform option '${feature}.${key}' must be a string`);
    }
  }
  return value as Readonly<Record<string, string>>;
}

function assertBooleanRecord(
  feature: string,
  value: unknown,
): Readonly<Record<string, boolean>> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`esbuild transform option '${feature}' must be an object`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'boolean') {
      throw new TypeError(`esbuild transform option '${feature}.${key}' must be a boolean`);
    }
  }
  return value as Readonly<Record<string, boolean>>;
}

function notImplementedOption(option: string, hint?: string): never {
  throw new NotImplementedError(`esbuild.transform.${option}`, hint);
}

function validateTransformOptions(options: EsbuildTransformOptions): void {
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && !SUPPORTED_OPTIONS.has(key)) notImplementedOption(key);
  }
  if (options.sourcemap === 'both') {
    notImplementedOption('sourcemap', 'CLI bridge cannot return both inline and external maps yet');
  }
  if (options.legalComments === 'external' || options.legalComments === 'linked') {
    notImplementedOption('legalComments');
  }
  assertStringRecord('define', options.define);
  assertBooleanRecord('supported', options.supported);
}

function pushStringRecordOptions(
  args: string[],
  prefix: string,
  entries: Readonly<Record<string, string>> | undefined,
): void {
  for (const [key, value] of Object.entries(entries ?? {})) args.push(`${prefix}:${key}=${value}`);
}

export function splitInlineSourcemap(code: string): {
  readonly code: string;
  readonly map: string;
} {
  const match = code.match(INLINE_SOURCEMAP);
  if (!match?.[1]) {
    throw new Error('esbuild transform did not emit the requested inline sourcemap');
  }
  return { code: code.slice(0, match.index), map: atob(match[1]) };
}

function esbuildArgs(options: EsbuildTransformOptions): string[] {
  validateTransformOptions(options);
  const loader = options.loader ?? 'js';
  const format = options.format ?? 'esm';
  const args = ['esbuild', `--loader=${loader}`, `--format=${format}`];
  pushStringOption(args, '--jsx', options.jsx);
  pushStringOption(args, '--jsx-factory', options.jsxFactory);
  pushStringOption(args, '--jsx-fragment', options.jsxFragment);
  pushStringOption(args, '--jsx-import-source', options.jsxImportSource);
  pushBooleanOption(args, '--jsx-dev', options.jsxDev);
  pushStringOption(args, '--platform', options.platform);
  pushStringOption(args, '--sourcefile', options.sourcefile);
  pushStringOption(args, '--charset', options.charset);
  pushStringOption(args, '--legal-comments', options.legalComments);
  pushBooleanFlag(args, '--keep-names', options.keepNames);
  pushStringOption(args, '--log-level', options.logLevel);
  pushNumberOption(args, '--log-limit', options.logLimit);
  pushBooleanFlag(args, '--minify', options.minify);
  pushBooleanFlag(args, '--minify-identifiers', options.minifyIdentifiers);
  pushBooleanFlag(args, '--minify-syntax', options.minifySyntax);
  pushBooleanFlag(args, '--minify-whitespace', options.minifyWhitespace);
  pushBooleanOption(args, '--tree-shaking', options.treeShaking);
  pushStringRecordOptions(args, '--define', assertStringRecord('define', options.define));
  const target = Array.isArray(options.target) ? options.target.join(',') : options.target;
  pushStringOption(args, '--target', target);
  if (options.tsconfigRaw !== undefined) {
    args.push(
      `--tsconfig-raw=${
        typeof options.tsconfigRaw === 'string'
          ? options.tsconfigRaw
          : JSON.stringify(options.tsconfigRaw)
      }`,
    );
  }
  for (const [feature, enabled] of Object.entries(
    assertBooleanRecord('supported', options.supported) ?? {},
  )) {
    args.push(`--supported:${feature}=${String(enabled)}`);
  }
  if (options.sourcemap) args.push('--sourcemap=inline');
  return args;
}

export function createEsbuildTransformBridge(workspace: string): EsbuildTransformBridge {
  return async (input, options = {}) => {
    const args = esbuildArgs(options);
    const wasm = await loadEsbuildModule();
    const source = enc.encode(sourceText(input));
    let delivered = false;
    const stderrChunks: string[] = [];
    const result = await runWasi(wasm, {
      args,
      env: {},
      preopens: { [workspace]: workspace },
      cwd: workspace,
      stderr: (chunk) => stderrChunks.push(chunk),
      stdin: () => {
        if (delivered) return null;
        delivered = true;
        return source;
      },
    });
    const stderr = stderrChunks.join('');
    if (result.exitCode !== 0) {
      throw new Error(
        `esbuild transform failed (exit ${result.exitCode}):\n${stderr || result.stderr}`,
      );
    }
    if (stderr.trim().length > 0) {
      // TODO(backlog: runtime-wasi/esbuild-transform-warnings): return successful esbuild warnings instead of throwing.
      throw new NotImplementedError('esbuild.transform.warnings', stderr.trim());
    }
    const wantsExternalMap = options.sourcemap && options.sourcemap !== 'inline';
    const transformed = wantsExternalMap
      ? splitInlineSourcemap(result.stdout)
      : { code: result.stdout, map: '' };
    return {
      code: transformed.code,
      map: transformed.map,
      warnings: [],
    };
  };
}

export function installEsbuildTransformBridge(workspace: string): void {
  globalThis.__riftyEsbuildTransform = createEsbuildTransformBridge(workspace);
}
