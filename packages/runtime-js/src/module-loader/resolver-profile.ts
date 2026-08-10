import { parse as acornParse } from 'acorn';

export interface FileDirResolutionOrder {
  readonly extensions: readonly string[];
  readonly indexFiles: readonly string[];
  readonly useModuleField: boolean;
}

// Import keeps rifty's ratified TS-aware fallback after Node's JS family.
const IMPORT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json'] as const;
const IMPORT_INDEX_FILES = [
  'index.js',
  'index.mjs',
  'index.cjs',
  'index.ts',
  'index.tsx',
  'index.json',
] as const;

// Node require fallback never invents an ESM/TS-family suffix. Explicit ESM
// files and package targets remain eligible after the resolver names them.
const REQUIRE_EXTENSIONS = ['.js', '.json', '.node'] as const;
const REQUIRE_INDEX_FILES = ['index.js', 'index.json', 'index.node'] as const;

const TSCONFIG_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const;
const TSCONFIG_INDEX_FILES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'index.mjs',
  'index.cjs',
  'index.json',
] as const;

export const IMPORT_RESOLUTION: FileDirResolutionOrder = {
  extensions: IMPORT_EXTENSIONS,
  indexFiles: IMPORT_INDEX_FILES,
  useModuleField: true,
};

const REQUIRE_RESOLUTION: FileDirResolutionOrder = {
  extensions: REQUIRE_EXTENSIONS,
  indexFiles: REQUIRE_INDEX_FILES,
  useModuleField: false,
};

export const TSCONFIG_RESOLUTION: FileDirResolutionOrder = {
  extensions: TSCONFIG_EXTENSIONS,
  indexFiles: TSCONFIG_INDEX_FILES,
  useModuleField: true,
};

export function resolutionOrder(esm: boolean): FileDirResolutionOrder {
  return esm ? IMPORT_RESOLUTION : REQUIRE_RESOLUTION;
}

export type ResolutionCondition = 'node' | 'default' | 'import' | 'require' | 'module-sync';

export function activeConditions(esm: boolean): readonly ResolutionCondition[] {
  return esm
    ? (['node', 'import', 'module-sync', 'default'] as const)
    : (['node', 'require', 'module-sync', 'default'] as const);
}

/** Node's ambiguous `.js` syntax detection after package-scope classification. */
export function detectJavaScriptKind(
  scopeType: string | undefined,
  source: string,
  syntaxDetection: boolean,
): 'cjs' | 'esm' {
  if (scopeType === 'module') return 'esm';
  if (scopeType === 'commonjs' || !syntaxDetection) return 'cjs';
  return !parsesAsCommonJs(source) && parsesAsEsm(source) ? 'esm' : 'cjs';
}

function parsesAsCommonJs(source: string): boolean {
  try {
    // Parse the real wrapper: top-level return stays valid while lexical
    // collisions with Node's injected bindings make the CJS parse fail.
    acornParse(`(function (exports, require, module, __filename, __dirname) {\n${source}\n});`, {
      ecmaVersion: 'latest',
      sourceType: 'script',
    });
    return true;
  } catch {
    return false;
  }
}

function parsesAsEsm(source: string): boolean {
  try {
    acornParse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    return true;
  } catch {
    return false;
  }
}
