import { NotImplementedError } from '@riftydev/io';
import { readRuntimeEsbuild } from '@riftydev/runtime-js';
import type { FsSync } from '@riftydev/vfs';
const EXACT_ESBUILD_VITE_VERSION = '7.3.6';

export type ViteEsbuildRuntimeDecision = 'start' | 'skip-rolldown';

/** One version gate for every Vite entry path that may consume esbuild. */
export function decideViteEsbuildRuntime(options: {
  readonly fs: FsSync;
  readonly packageRoot: string;
}): ViteEsbuildRuntimeDecision {
  const manifestPath = `${options.packageRoot}/package.json`;
  if (!options.fs.existsSync(manifestPath)) {
    throw new Error(`vite esbuild runtime cannot read executed package: ${manifestPath}`);
  }
  let manifest: { readonly name?: unknown; readonly version?: unknown };
  try {
    manifest = JSON.parse(new TextDecoder().decode(options.fs.readFileBytesSync(manifestPath))) as {
      readonly name?: unknown;
      readonly version?: unknown;
    };
  } catch (error) {
    throw new Error(`vite esbuild runtime found invalid package.json: ${manifestPath}`, {
      cause: error,
    });
  }
  if (manifest.name !== 'vite' || typeof manifest.version !== 'string') {
    throw new Error(`vite esbuild runtime found invalid package metadata: ${manifestPath}`);
  }
  if (manifest.version === EXACT_ESBUILD_VITE_VERSION) return 'start';
  if (/^8\./.test(manifest.version)) return 'skip-rolldown';
  throw new Error(
    `vite esbuild runtime supports exact Vite ${EXACT_ESBUILD_VITE_VERSION}; executed ${manifest.version}`,
  );
}

/** Concrete Vite edge: gate its version, then require generic dispatch to have run. */
export function prepareViteEsbuildRuntime(options: {
  readonly fs: FsSync;
  readonly packageRoot: string;
}): void {
  if (decideViteEsbuildRuntime(options) === 'skip-rolldown') return;
  if (readRuntimeEsbuild() === null) {
    throw new NotImplementedError('vite.esbuild.runtime');
  }
}
