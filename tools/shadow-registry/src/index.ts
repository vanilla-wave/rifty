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

// Must match the exact `esbuild-wasm` devDependency pin in apps/playground
// (ADR-0192 single-host-instance: one esbuild per guest, no version skew).
const SHIM_ESBUILD_VERSION = '0.27.7';

const SHIM_ESBUILD_SOURCE = `// rifty: esbuild shim — the real esbuild JS API, delegated to the host-realm
// esbuild-wasm instance (ADR-0192). Guest and host share the worker realm, so
// options, results, and JS plugin callbacks cross the bridge untouched.
const NotImplementedError = class extends Error {
  constructor(feature, hint) {
    super('Not implemented: ' + feature + (hint ? ' (' + hint + ')' : ''));
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
};

function hostEsbuild() {
  const host = globalThis.__riftyEsbuild;
  if (!host) {
    throw new Error(
      'rifty: esbuild host bridge missing — installEsbuildBridge() must run before esbuild is imported (prepareViteCli/bootDevServer/bootBuild wiring)',
    );
  }
  return host;
}

export const version = hostEsbuild().version;

let initializeCalled = false;
export async function initialize(options = {}) {
  // Node esbuild parity: browser-only options are rejected and a second
  // call throws; the actual service start is owned by the host bridge.
  if (options.wasmURL || options.wasmModule || options.worker !== undefined) {
    throw new Error('The "wasmURL", "wasmModule" and "worker" options only work in esbuild-wasm');
  }
  if (initializeCalled) {
    throw new Error('Cannot call "initialize" more than once');
  }
  initializeCalled = true;
  await hostEsbuild().initialize();
}

export function transform(input, options) {
  return hostEsbuild().transform(input, options);
}

export function build(options) {
  return hostEsbuild().build(options);
}

export function context(options) {
  return hostEsbuild().context(options);
}

export function formatMessages(messages, options) {
  return hostEsbuild().formatMessages(messages, options);
}

export function analyzeMetafile(metafile, options) {
  return hostEsbuild().analyzeMetafile(metafile, options);
}

export function stop() {
  return hostEsbuild().stop();
}

export function transformSync(_input, _options) {
  throw new NotImplementedError('esbuild.transformSync', 'esbuild-wasm exposes no synchronous API in a browser realm');
}

export function buildSync(_options) {
  throw new NotImplementedError('esbuild.buildSync', 'esbuild-wasm exposes no synchronous API in a browser realm');
}

export function formatMessagesSync(_messages, _options) {
  throw new NotImplementedError('esbuild.formatMessagesSync', 'esbuild-wasm exposes no synchronous API in a browser realm');
}

export function analyzeMetafileSync(_metafile, _options) {
  throw new NotImplementedError('esbuild.analyzeMetafileSync', 'esbuild-wasm exposes no synchronous API in a browser realm');
}

export const default_ = {
  version,
  initialize,
  transform,
  transformSync,
  build,
  buildSync,
  context,
  formatMessages,
  formatMessagesSync,
  analyzeMetafile,
  analyzeMetafileSync,
  stop,
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
// Build differs from dev only in the rollup overlay (real WASM parser); the
// esbuild shim is ONE honest delegation for both (ADR-0192).
export const viteBuildShimFiles: Record<string, string> = {
  ...esbuildShimFiles,
  ...lightningcssShimFiles,
  ...rollupBuildShimFiles,
};
