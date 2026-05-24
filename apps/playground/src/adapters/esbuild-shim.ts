// playground adapter today; promote to `@rifty/npm-client/shims` when a third
// such shim lands.
/**
 * Browser-realm shim for the `esbuild` npm package.
 *
 * The real `esbuild` package launches a binary subprocess to do the actual
 * compilation work; that doesn't fly in a browser tab. For the M10 demo we
 * substitute a minimal stand-in that:
 *
 *   - returns `code` unchanged from `transform` (Vite calls this for any
 *     `.js` source — passthrough keeps the dev path alive)
 *   - throws `NotImplementedError` from `build` / `context` so we never
 *     silently drop a real compilation pipeline
 *   - reports a plausible `version` string so Vite's compatibility checks pass
 *
 * If/when the WASI runner can host `esbuild.wasm` end-to-end (M8 follow-up),
 * this shim becomes the place to swap in a real transformer.
 */

const SHIM_VERSION = '0.21.5';

const SHIM_SOURCE = `// rifty: esbuild shim — passthrough only (see CHANGELOG)
const NotImplementedError = class extends Error {
  constructor(feature, hint) {
    super('Not implemented: ' + feature + (hint ? ' (' + hint + ')' : ''));
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
};

export const version = ${JSON.stringify(SHIM_VERSION)};

export async function initialize(_opts) {
  return undefined;
}

function defaultLoaderFor(_path) {
  return 'js';
}

export async function transform(input, options = {}) {
  const code = typeof input === 'string' ? input : new TextDecoder().decode(input);
  // Pass-through: callers will get untransformed JS back. We still strip TS
  // type-only imports naïvely so a small set of TS sources don't blow up.
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

const SHIM_PACKAGE_JSON = JSON.stringify(
  {
    name: 'esbuild',
    version: SHIM_VERSION,
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

export const esbuildShimFiles: Record<string, string> = {
  '/workspace/node_modules/esbuild/package.json': SHIM_PACKAGE_JSON,
  '/workspace/node_modules/esbuild/lib/main.js': SHIM_SOURCE,
};

/**
 * Rollup's native.js loads platform-specific bindings (`@rollup/rollup-<plat>-<arch>`)
 * to get a fast Rust-based parser and xxhash. In a browser realm we have no
 * such binary. This shim returns pure-JS stand-ins so Vite — which depends on
 * `parseAst` from rollup — can boot. The AST returned is a minimal Program
 * stub (no body); xxhash falls back to a deterministic short hash.
 */
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

export const rollupShimFiles: Record<string, string> = {
  '/workspace/node_modules/rollup/dist/native.js': ROLLUP_NATIVE_SHIM,
};
