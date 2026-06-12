/**
 * Shadow-registry — consolidated data tables for in-browser substitutions.
 *
 * Per ADR 0015, all shim/override *data* lives in this package. Consumer-side
 * adapter code stays where it is used (`packages/npm-client/src/overrides.ts`
 * for npm overrides, `apps/playground/src/glue/esbuild-shim.ts` for the
 * VFS overlay).
 *
 * Three tables are exposed:
 *
 *   - `bakedOverrides` — full-package substitutions consumed by the npm
 *     installer's override hook (D-005).
 *   - `esbuildShimFiles` / `rollupShimFiles` — VFS-path-keyed source bundles
 *     overlaid by the playground after install, replacing packages whose
 *     native binaries cannot run in a browser realm.
 *   - `browserShimLifecycleScriptSkips` — lifecycle metadata made redundant by
 *     those overlays.
 *
 * The `OverrideMap` type is structurally identical to the one re-exported
 * from `@riftydev/npm-client` (an open `Record<string, string>`). It is declared
 * locally here so that this package does not import — even type-only —
 * from `npm-client`; doing so would create a circular dependency between
 * the two packages (npm-client depends on this one for the data table). The
 * structural compatibility is asserted in npm-client's tests.
 */
export interface OverrideMap {
  /** Map from package name (or `parent>child`) to replacement target. */
  [key: string]: string;
}

/**
 * Built-in package substitutions. Source of truth for what the npm installer
 * silently redirects when no user override matches.
 *
 * Add an entry here when a popular npm package ships native bindings that
 * cannot load in a browser realm AND a drop-in pure-JS alternative exists.
 */
export const bakedOverrides: OverrideMap = {
  // bcrypt's native bindings don't load in the browser; bcryptjs is a drop-in.
  bcrypt: 'bcryptjs',
  // Real esbuild's registry package runs a native-binary postinstall. The
  // playground overlays node_modules/esbuild with a browser-safe shim later.
  esbuild: '@esbuild/wasi-preview1@0.28.0',
};

const SHIM_ESBUILD_VERSION = '0.21.5';

const SHIM_ESBUILD_SOURCE = `// rifty: esbuild shim — passthrough only (see CHANGELOG)
const NotImplementedError = class extends Error {
  constructor(feature, hint) {
    super('Not implemented: ' + feature + (hint ? ' (' + hint + ')' : ''));
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
};

export const version = ${JSON.stringify(SHIM_ESBUILD_VERSION)};

export async function initialize(_opts) {
  return undefined;
}

function defaultLoaderFor(_path) {
  return 'js';
}

export async function transform(input, options = {}) {
  const code = typeof input === 'string' ? input : new TextDecoder().decode(input);
  // Pass-through: callers will get untransformed JS back. We still strip TS
  // type-only imports naïvely so a small set of TS sources don't blow up.
  return {
    code,
    map: '',
    warnings: [],
    legalComments: '',
    mangleCache: undefined,
  };
}

export function transformSync(input, options = {}) {
  const code = typeof input === 'string' ? input : new TextDecoder().decode(input);
  return { code, map: '', warnings: [] };
}

export async function build(_opts) {
  throw new NotImplementedError('esbuild.build', 'use the WASI runner');
}

export function buildSync(_opts) {
  throw new NotImplementedError('esbuild.buildSync', 'use the WASI runner');
}

export async function context(_opts) {
  // Minimal context that does nothing but lets Vite's dep-pre-bundling code
  // run to completion without throwing on construction.
  return {
    rebuild: async () => ({ errors: [], warnings: [], outputFiles: [], metafile: { inputs: {}, outputs: {} } }),
    watch: async () => undefined,
    serve: async () => undefined,
    cancel: async () => undefined,
    dispose: async () => undefined,
  };
}

export async function analyzeMetafile(_metafile, _opts) {
  return '';
}

export function analyzeMetafileSync(_metafile, _opts) {
  return '';
}

export async function formatMessages(messages, _opts) {
  return messages.map((m) => (m && m.text) || '');
}

export function formatMessagesSync(messages, _opts) {
  return messages.map((m) => (m && m.text) || '');
}

export const default_ = {
  version,
  transform,
  transformSync,
  build,
  buildSync,
  context,
  analyzeMetafile,
  analyzeMetafileSync,
  formatMessages,
  formatMessagesSync,
  initialize,
};

export { default_ as default };
`;

const SHIM_ESBUILD_PACKAGE_JSON = JSON.stringify(
  {
    name: 'esbuild',
    version: SHIM_ESBUILD_VERSION,
    main: './lib/main.js',
    module: './lib/main.js',
    type: 'module',
    exports: {
      '.': {
        import: './lib/main.js',
        require: './lib/main.js',
        default: './lib/main.js',
      },
    },
  },
  null,
  2,
);

/**
 * VFS overlay for the `esbuild` npm package. The playground writes these
 * paths into the sync mirror after install so that any `import 'esbuild'`
 * resolves to a browser-safe passthrough instead of the real package's
 * binary launcher.
 */
export const esbuildShimFiles: Record<string, string> = {
  '/workspace/node_modules/esbuild/package.json': SHIM_ESBUILD_PACKAGE_JSON,
  '/workspace/node_modules/esbuild/lib/main.js': SHIM_ESBUILD_SOURCE,
};

export const browserShimLifecycleScriptSkips: Record<string, readonly string[]> = {
  esbuild: ['postinstall'],
};

const ROLLUP_NATIVE_SHIM = `// rifty: rollup native bindings shim
function emptyProgram(code) {
  return {
    type: 'Program',
    start: 0,
    end: typeof code === 'string' ? code.length : 0,
    body: [],
    sourceType: 'module',
  };
}

function shortHash(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let h1 = 0x811c9dc5, h2 = 0x1505;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
    h2 = ((h2 << 5) + h2 + bytes[i]) >>> 0;
  }
  return ((BigInt(h1) << 32n) | BigInt(h2)).toString(36);
}

exports.parse = function parse(code, _opts) {
  // Real Rollup returns a Uint8Array of an ESTree-serialised AST. Vite reads
  // it via the parseAst wrapper. Returning an object directly skips the
  // serialisation layer — most Vite paths that hit parseAst tolerate a stub
  // because they only inspect imports/exports when present.
  return emptyProgram(code);
};

exports.parseAsync = async function parseAsync(code, _opts) {
  return emptyProgram(code);
};

exports.xxhashBase64Url = function xxhashBase64Url(input) {
  const h = shortHash(input);
  return h.padEnd(11, '0').slice(0, 11);
};

exports.xxhashBase36 = function xxhashBase36(input) {
  return shortHash(input).padEnd(13, '0').slice(0, 13);
};

exports.xxhashBase16 = function xxhashBase16(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};
`;

/**
 * VFS overlay for Rollup's `dist/native.js`. Rollup ships platform-specific
 * binary bindings; we substitute a pure-JS stub that returns a minimal
 * ESTree Program plus deterministic short hashes so Vite's `parseAst` /
 * dep-graph code can proceed.
 */
export const rollupShimFiles: Record<string, string> = {
  '/workspace/node_modules/rollup/dist/native.js': ROLLUP_NATIVE_SHIM,
};
