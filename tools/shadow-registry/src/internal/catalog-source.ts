import { shadowSha256 } from './canonical.ts';
import type { ShadowCatalogDefinition, ShadowMaterializationFile } from './model.ts';

export const ESBUILD_ALIAS_MAIN = `const esbuild = globalThis.__rifty?.esbuild;
if (esbuild == null) {
  throw new Error('rifty invariant: esbuild runtime slot is not initialized');
}
module.exports = esbuild;
0 && (module.exports = {
  analyzeMetafile,
  analyzeMetafileSync,
  build,
  buildSync,
  context,
  formatMessages,
  formatMessagesSync,
  initialize,
  stop,
  transform,
  transformSync,
  version,
});
`;

export const ESBUILD_ALIAS_BIN = `#!/usr/bin/env node
class NotImplementedError extends Error {
  constructor(feature) {
    super(\`Not implemented: \${feature}\`);
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
}
throw new NotImplementedError('esbuild.cli');
`;

export const ESBUILD_ALIAS_PACKAGE = JSON.stringify(
  {
    name: 'esbuild',
    version: '0.28.0',
    main: './lib/main.cjs',
    module: './lib/main.cjs',
    type: 'commonjs',
    bin: { esbuild: './bin/esbuild' },
    exports: {
      '.': { import: './lib/main.cjs', require: './lib/main.cjs', default: './lib/main.cjs' },
    },
  },
  null,
  2,
);

export const LIGHTNINGCSS_ALIAS_PACKAGE = JSON.stringify(
  {
    name: 'lightningcss',
    version: '1.32.0',
    main: './index.cjs',
    module: './index.mjs',
    type: 'module',
    exports: { '.': { import: './index.mjs', require: './index.cjs', default: './index.mjs' } },
  },
  null,
  2,
);

export const LIGHTNINGCSS_ALIAS_ESM = `export {
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

export const LIGHTNINGCSS_ALIAS_CJS = `module.exports = require('lightningcss-wasm');
`;

export const SASS_EMBEDDED_FACADE_PACKAGE = JSON.stringify(
  {
    name: 'sass-embedded',
    version: '1.100.0',
    main: 'dist/lib/index.js',
    exports: {
      import: { default: './dist/lib/index.mjs' },
      default: './dist/lib/index.js',
    },
    bin: { sass: 'dist/bin/sass.js' },
  },
  null,
  2,
);

export const SASS_EMBEDDED_FACADE_BIN = `#!/usr/bin/env node
class NotImplementedError extends Error {
  constructor(feature) {
    super('Not implemented: ' + feature);
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
}
if (process.argv.includes('--watch')) {
  throw new NotImplementedError('sass-embedded.watch');
}
throw new NotImplementedError('sass-embedded.cli');
`;

export const SASS_EMBEDDED_FACADE_CJS = `'use strict';

const sass = require('../../../sass/sass.node.js');
const {fileURLToPath} = require('node:url');

const DEAD_EXPORTS = new Set(['cli_pkg_main_0_', 'load', 'loadParserExports_']);
const ASYNC_IMPORTER_ERROR = "The canonicalize() function can't return a Promise for synchronous compile functions.";

class NotImplementedError extends Error {
  constructor(feature) {
    super('Not implemented: ' + feature);
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
}

function adaptSpan(span) {
  if (span == null || span.url !== null) return span;
  return new Proxy(span, {
    get(target, key) {
      return key === 'url' ? undefined : Reflect.get(target, key, target);
    },
  });
}

function absoluteFirstFrame(stack, url) {
  if (typeof stack !== 'string' || url == null) return stack;
  let path;
  try {
    path = fileURLToPath(url);
  } catch {
    return stack;
  }
  const newline = stack.indexOf('\\n');
  const first = newline === -1 ? stack : stack.slice(0, newline);
  const position = first.search(/ \\d+:\\d+(?:\\s|$)/);
  if (position === -1) return stack;
  const adapted = path + first.slice(position);
  return newline === -1 ? adapted : adapted + stack.slice(newline);
}

function adaptLoggerDetails(details, fallbackUrl) {
  if (details == null || typeof details !== 'object') return details;
  const stack = absoluteFirstFrame(details.stack, details.span?.url ?? fallbackUrl);
  return stack === details.stack ? details : {...details, stack};
}

function adaptCompileOptions(options) {
  const adapted = options == null
    ? {alertColor: false}
    : typeof options === 'object' && options.alertColor == null
      ? {...options, alertColor: false}
      : options;
  if (adapted == null || typeof adapted !== 'object' || adapted.logger == null) return adapted;
  const logger = adapted.logger;
  return {
    ...adapted,
    logger: {
      ...logger,
      warn(message, details) {
        return logger.warn(message, adaptLoggerDetails(details, adapted.url));
      },
    },
  };
}

function adaptCompileArgs(args) {
  if (args.length === 0) return args;
  return [args[0], adaptCompileOptions(args[1]), ...args.slice(2)];
}

function adaptException(error) {
  if (!(error instanceof sass.Exception) || error.message.startsWith(ASYNC_IMPORTER_ERROR)) {
    return error;
  }
  const span = Reflect.get(error, 'span', error);
  const originalStack = Reflect.get(error, 'sassStack', error);
  const stack = absoluteFirstFrame(originalStack, span?.url);
  const pathMessage = stack === originalStack
    ? error.message
    : error.message.replace(originalStack.trimEnd(), stack.trimEnd());
  const message = pathMessage.startsWith('Error: ') ? pathMessage : 'Error: ' + pathMessage;
  return new Proxy(error, {
    get(target, key) {
      if (key === 'message') return message;
      if (key === 'toString') return () => message;
      if (key === 'sassStack') return stack;
      if (key === 'span') return adaptSpan(span);
      return Reflect.get(target, key, target);
    },
  });
}

function adaptFailure(error, compilerKind) {
  if (error instanceof Error && error.message === 'Compiler has already been disposed.') {
    return new Error('Compiler caused error: ' + compilerKind + ' compiler has already been disposed.');
  }
  return adaptException(error);
}

function syncCall(run, compilerKind) {
  try {
    return run();
  } catch (error) {
    throw adaptFailure(error, compilerKind);
  }
}

async function asyncCall(run, compilerKind) {
  try {
    return await run();
  } catch (error) {
    throw adaptFailure(error, compilerKind);
  }
}

const compilerTargets = new WeakMap();
const SYNC_COMPILER_INTERNAL_KEYS = new Set([
  'process',
  'compilationId',
  'dispatchers',
  'stdout$',
  'stderr$',
  'disposed',
  'messageTransformer',
]);
const ASYNC_COMPILER_INTERNAL_KEYS = new Set([
  'process',
  'compilationId',
  'compilations',
  'disposed',
  'messageTransformer',
  'exit$',
  'stdout$',
  'stderr$',
]);

function compilerTarget(compiler) {
  const target = compilerTargets.get(compiler);
  if (target === undefined) throw new TypeError('Illegal compiler invocation');
  return target;
}

function initializedCompiler(Constructor, target, internalKeys) {
  const compiler = Object.create(Constructor.prototype);
  const proxy = new Proxy(compiler, {
    ownKeys() {
      throw new NotImplementedError('sass-embedded.compiler-internal-reflection');
    },
    get(target, key, receiver) {
      if (internalKeys.has(key)) {
        throw new NotImplementedError('sass-embedded.compiler-internal-reflection');
      }
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      if (internalKeys.has(key)) {
        throw new NotImplementedError('sass-embedded.compiler-internal-reflection');
      }
      return Reflect.has(target, key);
    },
    getOwnPropertyDescriptor(target, key) {
      if (internalKeys.has(key)) {
        throw new NotImplementedError('sass-embedded.compiler-internal-reflection');
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  compilerTargets.set(proxy, target);
  return proxy;
}

class Compiler {
  constructor(_direct) {
    throw new NotImplementedError('sass-embedded.compiler-construction-liveness');
  }

  compile(path, options) {
    const target = compilerTarget(this);
    const args = adaptCompileArgs(Array.from(arguments));
    return syncCall(() => Reflect.apply(target.compile, target, args), 'Sync');
  }

  compileString(source, options) {
    const target = compilerTarget(this);
    const args = adaptCompileArgs(Array.from(arguments));
    return syncCall(() => Reflect.apply(target.compileString, target, args), 'Sync');
  }

  dispose() {
    const target = compilerTarget(this);
    return Reflect.apply(target.dispose, target, arguments);
  }
}

class AsyncCompiler {
  constructor(_direct) {
    throw new NotImplementedError('sass-embedded.compiler-construction-liveness');
  }

  compileAsync(path, options) {
    const target = compilerTarget(this);
    const args = adaptCompileArgs(Array.from(arguments));
    return asyncCall(() => Reflect.apply(target.compileAsync, target, args), 'Async');
  }

  compileStringAsync(source, options) {
    const target = compilerTarget(this);
    const args = adaptCompileArgs(Array.from(arguments));
    return asyncCall(() => Reflect.apply(target.compileStringAsync, target, args), 'Async');
  }

  async dispose() {
    const target = compilerTarget(this);
    await Reflect.apply(target.dispose, target, arguments);
  }
}

function initCompiler(...args) {
  return initializedCompiler(Compiler, sass.initCompiler(...args), SYNC_COMPILER_INTERNAL_KEYS);
}

async function initAsyncCompiler(...args) {
  const target = await sass.initAsyncCompiler(...args);
  return initializedCompiler(AsyncCompiler, target, ASYNC_COMPILER_INTERNAL_KEYS);
}

function legacyOptions(options) {
  if (options == null || typeof options !== 'object' || options.logger == null) return options;
  const logger = options.logger;
  return {
    ...options,
    logger: {
      ...logger,
      warn(message, details) {
        if (details?.deprecationType?.id === 'legacy-js-api') {
          process.stderr.write('Deprecation [legacy-js-api]: ' + message + '\\n');
          return;
        }
        const adapted = adaptLoggerDetails(details, options.url);
        const stack = typeof adapted?.stack === 'string'
          ? adapted.stack.replace(/^stdin /, '- ')
          : adapted?.stack;
        logger.warn(message, {...adapted, stack});
      },
    },
  };
}

const facade = {};
for (const [key, value] of Object.entries(sass)) {
  if (!DEAD_EXPORTS.has(key)) facade[key] = value;
}

facade.info = 'sass-embedded\\t1.100.0';
facade.compile = (...args) => syncCall(() => sass.compile(...adaptCompileArgs(args)), 'Sync');
facade.compileAsync = (...args) => asyncCall(() => sass.compileAsync(...adaptCompileArgs(args)), 'Async');
facade.compileString = (...args) => syncCall(() => sass.compileString(...adaptCompileArgs(args)), 'Sync');
facade.compileStringAsync = (...args) => asyncCall(() => sass.compileStringAsync(...adaptCompileArgs(args)), 'Async');
facade.renderSync = (options) => syncCall(() => sass.renderSync(legacyOptions(options)), 'Sync');
facade.render = (options, callback) => sass.render(legacyOptions(options), (error, result) => callback(error == null ? null : adaptFailure(error, 'Async'), result));

Object.defineProperties(facade, {
  Compiler: {enumerable: true, configurable: true, get() { return Compiler; }},
  AsyncCompiler: {enumerable: true, configurable: true, get() { return AsyncCompiler; }},
  initCompiler: {enumerable: true, configurable: true, get() { return initCompiler; }},
  initAsyncCompiler: {enumerable: true, configurable: true, get() { return initAsyncCompiler; }},
});

module.exports = facade;
`;

export const SASS_EMBEDDED_FACADE_ESM = `import cjs from './index.js';

const facade = {
  ...cjs,
  get Compiler() { return cjs.Compiler; },
  get AsyncCompiler() { return cjs.AsyncCompiler; },
  get initCompiler() { return cjs.initCompiler; },
  get initAsyncCompiler() { return cjs.initAsyncCompiler; },
  CalculationOperator: undefined,
  CustomFunction: undefined,
  ListSeparator: undefined,
  PromiseOr: undefined,
};

export const {
  AsyncCompiler,
  CalculationInterpolation,
  CalculationOperation,
  CalculationOperator,
  Compiler,
  CustomFunction,
  Exception,
  FALSE,
  ListSeparator,
  Logger,
  NULL,
  NodePackageImporter,
  PromiseOr,
  SassArgumentList,
  SassBoolean,
  SassCalculation,
  SassColor,
  SassFunction,
  SassList,
  SassMap,
  SassMixin,
  SassNumber,
  SassString,
  TRUE,
  Value,
  Version,
  compile,
  compileAsync,
  compileString,
  compileStringAsync,
  deprecations,
  info,
  initAsyncCompiler,
  initCompiler,
  render,
  renderSync,
  sassFalse,
  sassNull,
  sassTrue,
  types,
} = facade;

export default facade;
`;

function file(path: string, content: string): ShadowMaterializationFile {
  return {
    path,
    content,
    sha256: shadowSha256(content),
    bytes: new TextEncoder().encode(content).byteLength,
  };
}

export const builtinShadowCatalogSource: ShadowCatalogDefinition = {
  schema: 2,
  id: 'rifty.shadow-substitutions.builtin.v2',
  recipes: [
    {
      schema: 2,
      id: 'rifty.shadow-substitution.esbuild.v2',
      trigger: { name: 'esbuild', version: '0.28.0' },
      admission: {
        kind: 'semver-admits',
        unsupportedFeature: 'esbuild.version',
      },
      acquisition: { kind: 'synthetic' },
      materialization: {
        name: 'esbuild',
        version: '0.28.0',
        bin: { esbuild: 'bin/esbuild' },
        files: [
          file('bin/esbuild', ESBUILD_ALIAS_BIN),
          file('lib/main.cjs', ESBUILD_ALIAS_MAIN),
          file('package.json', ESBUILD_ALIAS_PACKAGE),
        ],
      },
      binding: {
        adapterId: 'rifty.runtime-adapter.esbuild.v1',
        assets: ['esbuild-wasm@0.28.0/package/esbuild.wasm'],
      },
    },
    {
      schema: 2,
      id: 'rifty.shadow-substitution.lightningcss.v2',
      trigger: { name: 'lightningcss', version: '1.32.0' },
      admission: {
        kind: 'semver-admits',
        unsupportedFeature: 'lightningcss.version',
      },
      acquisition: {
        kind: 'registry',
        name: 'lightningcss-wasm',
        version: '1.32.0',
        dependencyProjection: {
          dependencies: { 'napi-wasm': '^1.0.1' },
          optionalDependencies: {},
          omittedOptionalDependencies: {},
          peerDependencies: {},
          bundledDependencies: ['napi-wasm'],
          unsupportedFeature: 'lightningcss.acquisition',
        },
      },
      materialization: {
        name: 'lightningcss',
        version: '1.32.0',
        bin: {},
        files: [
          file('index.cjs', LIGHTNINGCSS_ALIAS_CJS),
          file('index.mjs', LIGHTNINGCSS_ALIAS_ESM),
          file('package.json', LIGHTNINGCSS_ALIAS_PACKAGE),
        ],
      },
    },
    {
      schema: 2,
      id: 'rifty.shadow-substitution.sass-embedded.v2',
      trigger: { name: 'sass-embedded', version: '1.100.0' },
      admission: {
        kind: 'exact-only',
        unsupportedFeature: 'sass-embedded.version',
      },
      acquisition: {
        kind: 'registry',
        name: 'sass',
        version: '1.100.0',
        dependencyProjection: {
          dependencies: {
            chokidar: '^5.0.0',
            immutable: '^5.1.5',
            'source-map-js': '>=0.6.2 <2.0.0',
          },
          optionalDependencies: {},
          omittedOptionalDependencies: { '@parcel/watcher': '^2.4.1' },
          peerDependencies: {},
          bundledDependencies: [],
          unsupportedFeature: 'sass-embedded.acquisition',
        },
      },
      materialization: {
        name: 'sass-embedded',
        version: '1.100.0',
        bin: { sass: 'dist/bin/sass.js' },
        files: [
          file('dist/bin/sass.js', SASS_EMBEDDED_FACADE_BIN),
          file('dist/lib/index.js', SASS_EMBEDDED_FACADE_CJS),
          file('dist/lib/index.mjs', SASS_EMBEDDED_FACADE_ESM),
          file('package.json', SASS_EMBEDDED_FACADE_PACKAGE),
        ],
      },
    },
  ],
  assets: [
    {
      id: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
      source: {
        name: 'esbuild-wasm',
        version: '0.28.0',
        integrity:
          'sha512-5TRVKExcEmeMkccIZMzUq+Az6X2RoMAJyfl6SMMO1dMVhmvt0I2mx7gAb6zYi42n4d1ETcatFXazGKzA+aW7fg==',
      },
      member: 'package/esbuild.wasm',
      memberSha256: '9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b',
      memberSize: 13_918_738,
      maxTarballBytes: 3_845_798,
      maxUnpackedBytes: 14_483_968,
    },
  ],
};
