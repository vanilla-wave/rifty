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
export { bakedOverrides, type OverrideMap } from './index-data.ts';

/**
 * Built-in package substitutions. Source of truth for what the npm installer
 * redirects (loudly — every application prints a shadow-registry provenance
 * line, ADR-0188) when no user override matches.
 *
 * Add an entry here when a popular npm package ships native bindings that
 * cannot load in a browser realm AND a drop-in pure-JS alternative exists.
 */
export {
  builtinShadowAssetCatalog,
  type BuiltinShadowAssetCatalog,
  type BuiltinShadowAssetSubstitution,
  type ShadowAssetDescriptor,
  type ShadowAssetSourceDescriptor,
} from './shadow-asset-catalog.ts';
export {
  builtinSyntheticPackageRecipes,
  type BuiltinSyntheticPackageRecipe,
} from './synthetic-package-recipes.ts';

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
  /**
   * Exact public API version materialized under `into`. A redirect may expose
   * this alias only when its effective source request admits this version.
   */
  readonly apiVersion?: string;
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
  // Same for `lightningcss` → lightningcss-wasm (pure re-export delegates).
  'lightningcss-wasm': {
    range: '^1.32.0',
    into: 'lightningcss',
    apiVersion: SHIM_LIGHTNINGCSS_VERSION,
    files: {
      'package.json': SHIM_LIGHTNINGCSS_PACKAGE_JSON,
      'index.mjs': SHIM_LIGHTNINGCSS_ESM,
      'index.cjs': SHIM_LIGHTNINGCSS_CJS,
    },
  },
};
