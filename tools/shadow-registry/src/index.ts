/**
 * Shadow-registry — consolidated data tables for in-browser substitutions.
 *
 * Per ADR 0015, all shim/override *data* lives in this package. Consumer-side
 * adapter code stays in `@riftydev/npm-client` (`src/overrides.ts` for package
 * redirects, `src/shadow-shims.ts` for install-time internals shims, ADR-0188).
 *
 * Two tables are exposed:
 *
 *   - `bakedOverrides` — full-package substitutions consumed by the npm
 *     installer's override hook (D-005).
 *   - `internalsShims` — install-time file-sets keyed by the INSTALLED trigger
 *     package, written by `install()` into the actual installed package dir
 *     (nested/hoisted-aware). One content per (name, version-range) — never
 *     run-mode-dependent (ADR-0188).
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
 * redirects (loudly — every application prints a shadow-registry provenance
 * line, ADR-0188) when no user override matches.
 *
 * Add an entry here when a popular npm package ships native bindings that
 * cannot load in a browser realm AND a drop-in pure-JS alternative exists.
 */
export const bakedOverrides: OverrideMap = {
  // bcrypt's native bindings don't load in the browser; bcryptjs is a drop-in.
  bcrypt: 'bcryptjs',
  // Real esbuild's registry package runs a native-binary postinstall. The
  // installer materializes the `esbuild` import name from the shim below.
  esbuild: '@esbuild/wasi-preview1@0.28.0',
  // Vite 8 imports lightningcss lazily. The native package loads `.node`
  // bindings; lightningcss-wasm ships the same NAPI surface backed by WASM.
  lightningcss: 'lightningcss-wasm@1.32.0',
};

const SHIM_ESBUILD_VERSION = '0.21.5';

// ONE mode-independent esbuild entry (ADR-0188): the real async WASI transform
// bridge (dev module serving AND `vite build`), `build({ write:false })` for
// config bundling, and the tolerant no-op `context()` dev dep-scanning
// constructs under `optimizeDeps.noDiscovery` (build never calls it — vite
// production build does not pre-bundle deps here). Everything else loud-throws.
const SHIM_ESBUILD_SOURCE = `// rifty: esbuild shim — WASI transform bridge (shadow registry, install-time)
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
    throw new NotImplementedError('esbuild.transform', 'rifty runtime did not install the WASI transform bridge');
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

function loaderForPath(path) {
  if (/\\.tsx$/i.test(path)) return 'tsx';
  if (/\\.ts$/i.test(path)) return 'ts';
  if (/\\.jsx$/i.test(path)) return 'jsx';
  return 'js';
}

function firstEntryPoint(opts) {
  if (!Array.isArray(opts.entryPoints) || opts.entryPoints.length !== 1 || typeof opts.entryPoints[0] !== 'string') {
    throw new NotImplementedError('esbuild.build.entryPoints', 'rifty config bundling supports one string entry point');
  }
  return opts.entryPoints[0];
}

async function loadEntryThroughPlugins(opts, entry) {
  const onLoad = [];
  const api = {
    onResolve() {
      // The minimal config bridge does not traverse imports. Vite's own
      // externalize plugin may register resolvers; they are relevant only if a
      // config imports extra modules, which remains a loud gap below.
    },
    onLoad(options, callback) {
      onLoad.push({ filter: options && options.filter, callback });
    },
  };
  for (const plugin of opts.plugins || []) {
    if (plugin && typeof plugin.setup === 'function') plugin.setup(api);
  }
  for (const hook of onLoad) {
    if (hook.filter && !hook.filter.test(entry)) continue;
    const loaded = await hook.callback({ path: entry, namespace: 'file', pluginData: undefined });
    if (loaded) {
      return {
        contents: typeof loaded.contents === 'string' ? loaded.contents : decodeInput(loaded.contents || ''),
        loader: loaded.loader || loaderForPath(entry),
      };
    }
  }
  throw new NotImplementedError('esbuild.build.onLoad', 'rifty config bundling needs an onLoad result for the entry');
}

export async function build(opts = {}) {
  if (opts.write !== false) {
    throw new NotImplementedError('esbuild.build.write', 'rifty config bundling supports write:false only');
  }
  const entry = firstEntryPoint(opts);
  const loaded = await loadEntryThroughPlugins(opts, entry);
  const result = await transformBridge()(loaded.contents, {
    loader: loaded.loader,
    format: opts.format || 'esm',
    target: Array.isArray(opts.target) ? opts.target.join(',') : opts.target,
    sourcemap: opts.sourcemap,
  });
  const text = result.code;
  return {
    errors: [],
    warnings: result.warnings || [],
    outputFiles: [
      {
        path: opts.outfile || '<stdout>',
        contents: new TextEncoder().encode(text),
        text,
      },
    ],
    metafile: opts.metafile ? { inputs: { [entry]: {} }, outputs: {} } : undefined,
    mangleCache: undefined,
  };
}

export function buildSync(_opts) {
  throw new NotImplementedError('esbuild.buildSync', 'use vite build with the transform bridge');
}

export async function context(_opts) {
  // Minimal context that does nothing but lets Vite's dep-pre-bundling code
  // run to completion without throwing on construction (dev dep-scan with
  // noDiscovery). Production build never constructs a context here.
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

// ONE mode-independent rollup native entry (ADR-0188): always the real WASM
// parser. `@rollup/wasm-node` is guaranteed resolvable by the `companions`
// lockstep pin below — the dev empty-Program stub is gone (build needs the real
// serialized AST buffer; dev is simply more faithful with it).
const ROLLUP_NATIVE_SHIM = `// rifty: rollup native bindings shim — real WASM parser (shadow registry, install-time)
const native = require('@rollup/wasm-node/dist/native.js');

exports.parse = native.parse;
exports.parseAsync = native.parseAsync;
exports.xxhashBase64Url = native.xxhashBase64Url;
exports.xxhashBase36 = native.xxhashBase36;
exports.xxhashBase16 = native.xxhashBase16;
`;

/**
 * Install-time internals shim (ADR-0188). Applied by `@riftydev/npm-client`
 * whenever the KEY package installs at a version inside `range`; outside the
 * range the installer loud-throws `NotImplementedError('shadow-registry.<publicName>@<version>')`
 * — never a stale shim silently applied.
 */
export interface InternalsShim {
  /** Semver range of installed trigger versions the files are proven against. */
  readonly range: string;
  /**
   * Alias mode: write `files` into a SIBLING package dir of this name (same
   * `node_modules` scope as the trigger) instead of into the trigger itself —
   * materializes the ORIGINAL import name for a name-changing baked override.
   * Absent → in-place patch of the trigger package.
   */
  readonly into?: string;
  /** Files keyed by package-relative path (e.g. `dist/native.js`). */
  readonly files: Record<string, string>;
  /**
   * Packages the shim files require at EXACTLY the trigger's version
   * (lockstep); the installer injects them into the dep walk (ADR-0188).
   */
  readonly companions?: readonly string[];
}

/** Install-time internals shims keyed by the INSTALLED trigger package name. */
export const internalsShims: Record<string, InternalsShim> = {
  // Rollup ships platform-native bindings rifty can never run; the shim
  // delegates to @rollup/wasm-node, companion-pinned to rollup's own version
  // (the serialized AST buffer layout is version-coupled).
  rollup: {
    range: '^4.0.0',
    companions: ['@rollup/wasm-node'],
    files: { 'dist/native.js': ROLLUP_NATIVE_SHIM },
  },
  // bakedOverrides installs `@esbuild/wasi-preview1` under its own name; this
  // materializes the `esbuild` import name, delegating to the WASI bridge.
  '@esbuild/wasi-preview1': {
    range: '^0.28.0',
    into: 'esbuild',
    files: {
      'package.json': SHIM_ESBUILD_PACKAGE_JSON,
      'lib/main.js': SHIM_ESBUILD_SOURCE,
    },
  },
  // Same for `lightningcss` → lightningcss-wasm (pure re-export delegates).
  'lightningcss-wasm': {
    range: '^1.32.0',
    into: 'lightningcss',
    files: {
      'package.json': SHIM_LIGHTNINGCSS_PACKAGE_JSON,
      'index.mjs': SHIM_LIGHTNINGCSS_ESM,
      'index.cjs': SHIM_LIGHTNINGCSS_CJS,
    },
  },
};
