/**
 * Shadow-registry — consolidated data tables for in-browser substitutions.
 *
 * Per ADR 0015, all shim/override *data* lives in this package. Consumer-side
 * adapter code stays where it is used (`packages/npm-client/src/overrides.ts`
 * for npm overrides, `apps/playground/src/glue/esbuild-shim.ts` for the
 * VFS overlay).
 *
 * Two tables are exposed:
 *
 *   - `bakedOverrides` — full-package substitutions consumed by the npm
 *     installer's override hook (D-005).
 *   - `browserShimFileSets` / `collectBrowserShimFiles` — typed VFS-path-keyed
 *     source bundles overlaid by the playground after install, replacing
 *     packages whose native binaries cannot run in a browser realm.
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
  // Vite 8 imports lightningcss lazily. The native package loads `.node`
  // bindings; lightningcss-wasm ships the same NAPI surface backed by WASM.
  lightningcss: 'lightningcss-wasm@1.32.0',
};

const SHIM_ESBUILD_VERSION = '0.21.5';

const SHIM_ESBUILD_SOURCE = `// rifty: esbuild shim — transform delegated to the dev-server WASI bridge
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

export async function transform(input, options = {}) {
  const bridge = globalThis.__riftyEsbuildTransform;
  if (typeof bridge !== 'function') {
    throw new NotImplementedError('esbuild.transform', 'rifty dev-server did not install the WASI transform bridge');
  }
  return bridge(input, options);
}

export function transformSync(_input, _options = {}) {
  throw new NotImplementedError('esbuild.transformSync', 'the real WASI transform is async');
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
 * resolves to a browser-safe transform bridge instead of the real package's
 * binary launcher.
 */
export const esbuildShimFiles: Record<string, string> = {
  '/workspace/node_modules/esbuild/package.json': SHIM_ESBUILD_PACKAGE_JSON,
  '/workspace/node_modules/esbuild/lib/main.js': SHIM_ESBUILD_SOURCE,
};

const SHIM_ESBUILD_BUILD_SOURCE = `// rifty: esbuild shim — BUILD path, real async WASI transform bridge
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

function decodeInput(input) {
  return typeof input === 'string' ? input : new TextDecoder().decode(input);
}

function transformBridge() {
  const bridge = globalThis.__riftyEsbuildTransform;
  if (typeof bridge !== 'function') {
    throw new NotImplementedError('esbuild.transform', 'rifty build WASI bridge not installed');
  }
  return bridge;
}

export async function transform(input, options = {}) {
  const result = await transformBridge()(decodeInput(input), options);
  return {
    code: result.code,
    map: result.map,
    warnings: result.warnings || [],
    legalComments: '',
    mangleCache: undefined,
  };
}

export function transformSync(_input, _options = {}) {
  throw new NotImplementedError('esbuild.transformSync', 'rifty esbuild WASI bridge is async');
}

export async function build(_opts) {
  throw new NotImplementedError('esbuild.build', 'use vite build with the transform bridge');
}

export function buildSync(_opts) {
  throw new NotImplementedError('esbuild.buildSync', 'use vite build with the transform bridge');
}

export async function context(_opts) {
  throw new NotImplementedError('esbuild.context', 'vite production build does not use dep pre-bundling here');
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

export const esbuildBuildShimFiles: Record<string, string> = {
  '/workspace/node_modules/esbuild/package.json': SHIM_ESBUILD_PACKAGE_JSON,
  '/workspace/node_modules/esbuild/lib/main.js': SHIM_ESBUILD_BUILD_SOURCE,
};

const SHIM_LIGHTNINGCSS_VERSION = '1.32.0';

const SHIM_LIGHTNINGCSS_PACKAGE_JSON = JSON.stringify(
  {
    name: 'lightningcss',
    version: SHIM_LIGHTNINGCSS_VERSION,
    main: './index.cjs',
    module: './index.mjs',
    type: 'module',
    exports: {
      '.': {
        import: './index.mjs',
        require: './index.cjs',
        default: './index.mjs',
      },
    },
  },
  null,
  2,
);

const SHIM_LIGHTNINGCSS_ESM = `export {
  Features,
  browserslistToTargets,
  bundle,
  bundleAsync,
  composeVisitors,
  transform,
  transformStyleAttribute,
} from 'lightningcss-wasm';

import * as lightningcss from 'lightningcss-wasm';
export default lightningcss;
`;

const SHIM_LIGHTNINGCSS_CJS = `module.exports = require('lightningcss-wasm');
`;

/**
 * VFS overlay for the `lightningcss` npm package. Vite imports the native
 * package name, while the actual implementation comes from lightningcss-wasm.
 */
export const lightningcssShimFiles: Record<string, string> = {
  '/workspace/node_modules/lightningcss/package.json': SHIM_LIGHTNINGCSS_PACKAGE_JSON,
  '/workspace/node_modules/lightningcss/index.mjs': SHIM_LIGHTNINGCSS_ESM,
  '/workspace/node_modules/lightningcss/index.cjs': SHIM_LIGHTNINGCSS_CJS,
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

const ROLLUP_NATIVE_BUILD_SHIM = `// rifty: rollup native bindings shim — BUILD path, real WASM parser
const native = require('@rollup/wasm-node/dist/native.js');

exports.parse = native.parse;
exports.parseAsync = native.parseAsync;
exports.xxhashBase64Url = native.xxhashBase64Url;
exports.xxhashBase36 = native.xxhashBase36;
exports.xxhashBase16 = native.xxhashBase16;
`;

/**
 * Build-only Rollup overlay. Production build needs the real serialized AST
 * buffer; the dev path keeps the cheap stub above.
 */
export const rollupBuildShimFiles: Record<string, string> = {
  '/workspace/node_modules/rollup/dist/native.js': ROLLUP_NATIVE_BUILD_SHIM,
};

export interface BrowserShimFileSet {
  readonly packageName: string;
  readonly files: Record<string, string>;
}

export const browserShimFileSets = {
  esbuild: { packageName: 'esbuild', files: esbuildShimFiles },
  lightningcss: { packageName: 'lightningcss', files: lightningcssShimFiles },
  rollup: { packageName: 'rollup', files: rollupShimFiles },
} satisfies Record<string, BrowserShimFileSet>;

export type BrowserShimName = keyof typeof browserShimFileSets;

export function collectBrowserShimFiles(names: readonly BrowserShimName[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of names) Object.assign(files, browserShimFileSets[name].files);
  return files;
}

export const viteBrowserShimFiles = collectBrowserShimFiles(['esbuild', 'lightningcss', 'rollup']);
export const viteBuildShimFiles: Record<string, string> = {
  ...esbuildBuildShimFiles,
  ...lightningcssShimFiles,
  ...rollupBuildShimFiles,
};
