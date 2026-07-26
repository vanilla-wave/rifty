import { shadowSha256 } from './canonical.ts';
import type { ShadowCatalogDefinition, ShadowMaterializationFile } from './model.ts';

export const ESBUILD_ALIAS_MAIN = `const esbuild = globalThis.__rifty?.esbuild;
if (esbuild == null) {
  throw new Error('rifty invariant: esbuild runtime slot is not initialized');
}
module.exports = esbuild;
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
