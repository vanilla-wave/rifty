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

// MUST equal the bakedOverrides trigger pin: the alias package.json + the
// shim's `version` export claim this — a drifted static value would lie to
// version-sniffing consumers. The exact-pin `range` below enforces the couple
// (a bumped override outside it loud-throws at install until this moves too).
const SHIM_ESBUILD_VERSION = '0.28.0';

// ONE mode-independent esbuild entry (ADR-0188): the real async WASI transform
// bridge (dev module serving AND `vite build`) and `build({ write:false })` for
// SINGLE-MODULE config bundling. Everything the bridge cannot do for real
// loud-throws: multi-module bundling (local imports in the entry), a context()
// with entry points (only the EMPTY dep-optimizer context under
// `optimizeDeps.noDiscovery` constructs — its empty rebuild IS real esbuild's
// zero-entry result), non-empty analyzeMetafile. One body, two entries: ESM
// footer for import, CJS footer for require (real Node `require('esbuild')`
// works — the rifty loader loud-fails sync require of ESM).
const SHIM_ESBUILD_BODY = `// rifty: esbuild shim — WASI transform bridge (shadow registry, install-time)
const NotImplementedError = class extends Error {
  constructor(feature, hint) {
    super('Not implemented: ' + feature + (hint ? ' (' + hint + ')' : ''));
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
};

const version = ${JSON.stringify(SHIM_ESBUILD_VERSION)};

async function initialize(_opts) {
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

async function transform(input, options = {}) {
  const result = await transformBridge()(decodeInput(input), options);
  return {
    code: result.code,
    map: result.map,
    warnings: result.warnings || [],
    legalComments: '',
    mangleCache: undefined,
  };
}

function transformSync(_input, _options = {}) {
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
      // config imports extra modules — assertSingleModuleOutput keeps that loud.
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

function assertSingleModuleOutput(code, entry) {
  // Real esbuild build() BUNDLES local imports; this bridge transforms ONE
  // module. Succeeding while the output still imports './x' would hand the
  // caller a half-loaded config as "bundled" — a silent wrong answer. Bare
  // specifiers stay (vite's externalize plugin marks them external; real
  // esbuild leaves externals untouched); only relative/absolute file imports
  // are the lie, so they refuse loud.
  const local = /(?:\\bfrom\\s*["']|\\bimport\\s*\\(\\s*["']|\\bimport\\s*["']|\\brequire\\s*\\(\\s*["'])(\\.{1,2}\\/|\\/)/.exec(code);
  if (local) {
    throw new NotImplementedError(
      'esbuild.build.bundle',
      'rifty config bundling transforms the single entry module (' + entry + '); local file imports are not traversed — inline them or import a package',
    );
  }
}

async function build(opts = {}) {
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
  assertSingleModuleOutput(text, entry);
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

function buildSync(_opts) {
  throw new NotImplementedError('esbuild.buildSync', 'use vite build with the transform bridge');
}

async function context(opts = {}) {
  // Only the EMPTY dep-optimizer context constructs (dev dep-pre-bundling under
  // optimizeDeps.noDiscovery finds no entries; production build never gets
  // here). Its empty rebuild() result IS what real esbuild returns for zero
  // entry points — honest, not a stub. Entry points would need real
  // rebuild/watch, which the bridge cannot do: refuse loud at construction.
  const entryPoints = opts.entryPoints;
  const empty =
    entryPoints === undefined ||
    (Array.isArray(entryPoints) ? entryPoints.length === 0 : Object.keys(entryPoints).length === 0);
  if (!empty || opts.stdin) {
    throw new NotImplementedError(
      'esbuild.context',
      'rifty esbuild bridge cannot rebuild/watch entry points; only the empty dep-optimizer context (optimizeDeps.noDiscovery) is supported',
    );
  }
  return {
    rebuild: async () => ({ errors: [], warnings: [], outputFiles: [], metafile: { inputs: {}, outputs: {} } }),
    watch: async () => undefined,
    serve: async () => {
      throw new NotImplementedError('esbuild.context.serve', 'esbuild serve has no rifty bridge');
    },
    cancel: async () => undefined,
    dispose: async () => undefined,
  };
}

function analyzeMetafileSync(metafile, _opts) {
  const meta = (typeof metafile === 'string' ? JSON.parse(metafile) : metafile) || {};
  const hasWork = Object.keys(meta.inputs || {}).length > 0 || Object.keys(meta.outputs || {}).length > 0;
  if (hasWork) {
    throw new NotImplementedError('esbuild.analyzeMetafile', 'rifty esbuild bridge does not produce bundle analysis');
  }
  return '';
}

async function analyzeMetafile(metafile, opts) {
  return analyzeMetafileSync(metafile, opts);
}

async function formatMessages(messages, _opts) {
  return messages.map((m) => (m && m.text) || '');
}

function formatMessagesSync(messages, _opts) {
  return messages.map((m) => (m && m.text) || '');
}

const api = {
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
`;

const SHIM_ESBUILD_ESM = `${SHIM_ESBUILD_BODY}
export {
  version,
  initialize,
  transform,
  transformSync,
  build,
  buildSync,
  context,
  analyzeMetafile,
  analyzeMetafileSync,
  formatMessages,
  formatMessagesSync,
};
export default api;
`;

const SHIM_ESBUILD_CJS = `${SHIM_ESBUILD_BODY}
module.exports = api;
`;

// `type: module` classifies lib/main.js as ESM; the require condition MUST
// point at a real .cjs body or sync require('esbuild') loud-fails in the rifty
// loader while real Node succeeds (the lightningcss dual-entry pattern).
const SHIM_ESBUILD_PACKAGE_JSON = JSON.stringify(
  {
    name: 'esbuild',
    version: SHIM_ESBUILD_VERSION,
    main: './lib/main.cjs',
    module: './lib/main.js',
    type: 'module',
    exports: {
      '.': {
        import: './lib/main.js',
        require: './lib/main.cjs',
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
  // EXACT-pin range: the alias files statically claim SHIM_ESBUILD_VERSION —
  // any trigger version drift must loud-throw, not ship a lying package.json.
  '@esbuild/wasi-preview1': {
    range: '0.28.0',
    into: 'esbuild',
    files: {
      'package.json': SHIM_ESBUILD_PACKAGE_JSON,
      'lib/main.js': SHIM_ESBUILD_ESM,
      'lib/main.cjs': SHIM_ESBUILD_CJS,
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
