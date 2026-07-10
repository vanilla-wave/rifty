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

// MUST equal BOTH couplings: the bakedOverrides trigger pin (alias package.json
// + the shim's `version` export claim it; the exact-pin `range` below refuses a
// drifted trigger at install) AND apps/playground's exact `esbuild-wasm`
// devDependency (the host instance actually answering the API — a skew would
// lie to version-sniffing consumers like vite's optimizer; pinned by
// esbuild-host.test.ts).
const SHIM_ESBUILD_VERSION = '0.28.0';

// ONE mode-independent esbuild entry (ADR-0188): the REAL esbuild JS API,
// delegated to the host-realm esbuild-wasm instance (ADR-0192). Guest and host
// share the worker realm, so options, results, and JS plugin callbacks (vite's
// externalize-deps, esbuildDepPlugin) cross the bridge untouched — transform,
// build, context (rebuild/dispose/cancel/serve) all real. Loud-throw the gaps
// a browser realm cannot serve: the *Sync family (esbuild-wasm has no sync API)
// and `context({ write:true }).watch()` (watched-rebuild output writes are not
// normalized to the VFS yet — backlog playground/esbuild-context-watch-write-normalization).
// One body, two entries: ESM footer for import, CJS footer for require (real
// Node `require('esbuild')` works — the rifty loader loud-fails sync require
// of ESM).
const SHIM_ESBUILD_BODY = `// rifty: esbuild shim — real esbuild JS API via the host esbuild-wasm bridge (shadow registry, install-time)
const NotImplementedError = class extends Error {
  constructor(feature, hint) {
    super('Not implemented: ' + feature + (hint ? ' (' + hint + ')' : ''));
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
};

const version = ${JSON.stringify(SHIM_ESBUILD_VERSION)};

function hostEsbuild() {
  const host = globalThis.__riftyEsbuild;
  if (!host) {
    throw new Error(
      'rifty: esbuild host bridge missing — installEsbuildBridge() must run before the esbuild API is called (prepareViteCli/bootDevServer/bootBuild wiring)',
    );
  }
  return host;
}

let initializeWasCalled = false;
let initializePromise = null;
// Node esbuild parity — mirrors real main.js validateInitializeOptions +
// initialize() exactly: same check order (types, unknown keys, TRUTHY
// browser-only rejects — worker:false is accepted), same messages, SYNC
// throws. Actual service start is owned by the host bridge.
function validateInitializeOptions(options) {
  if (options.wasmURL !== undefined && typeof options.wasmURL !== 'string' && !(options.wasmURL instanceof URL)) {
    throw new Error('"wasmURL" must be a string or a URL');
  }
  if (options.wasmModule !== undefined && !(options.wasmModule instanceof WebAssembly.Module)) {
    throw new Error('"wasmModule" must be a WebAssembly.Module');
  }
  if (options.worker !== undefined && typeof options.worker !== 'boolean') {
    throw new Error('"worker" must be a boolean');
  }
  for (const key in options) {
    if (key !== 'wasmURL' && key !== 'wasmModule' && key !== 'worker') {
      throw new Error('Invalid option in initialize() call: ' + JSON.stringify(key));
    }
  }
}
function initialize(options) {
  options = options || {};
  validateInitializeOptions(options);
  if (options.wasmURL) throw new Error('The "wasmURL" option only works in the browser');
  if (options.wasmModule) throw new Error('The "wasmModule" option only works in the browser');
  if (options.worker) throw new Error('The "worker" option only works in the browser');
  if (initializeWasCalled || initializePromise) {
    throw new Error('Cannot call "initialize" more than once');
  }
  initializePromise = (async () => {
    try {
      await hostEsbuild().initialize();
      initializeWasCalled = true;
    } finally {
      initializePromise = null;
    }
  })();
  return initializePromise;
}

function transform(input, options) {
  return hostEsbuild().transform(input, options);
}

function build(options) {
  return hostEsbuild().build(options);
}

function context(options) {
  return hostEsbuild().context(options);
}

function formatMessages(messages, options) {
  return hostEsbuild().formatMessages(messages, options);
}

function analyzeMetafile(metafile, options) {
  return hostEsbuild().analyzeMetafile(metafile, options);
}

function stop() {
  // Real-Node parity: stop() re-permits initialize() (main.js stopService sets
  // initializeWasCalled = false; the service respawns on the next API call).
  // MUST NOT stop the host: the esbuild-wasm service is shared realm-wide
  // (vite's own transforms ride it), while in real Node each process owns its
  // own child service — one consumer's stop() never kills another's. Reset the
  // local gate only; observable guest behavior matches real Node.
  initializeWasCalled = false;
  initializePromise = null;
  return Promise.resolve();
}

function transformSync(_input, _options) {
  throw new NotImplementedError('esbuild.transformSync', 'esbuild-wasm exposes no synchronous API in a browser realm');
}

function buildSync(_options) {
  throw new NotImplementedError('esbuild.buildSync', 'esbuild-wasm exposes no synchronous API in a browser realm');
}

function formatMessagesSync(_messages, _options) {
  throw new NotImplementedError('esbuild.formatMessagesSync', 'esbuild-wasm exposes no synchronous API in a browser realm');
}

function analyzeMetafileSync(_metafile, _options) {
  throw new NotImplementedError('esbuild.analyzeMetafileSync', 'esbuild-wasm exposes no synchronous API in a browser realm');
}

const api = {
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
  stop,
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
  stop,
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
