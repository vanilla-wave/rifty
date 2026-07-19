import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { canonicalJson } from '../src/install-artifact-recipe.ts';

const outputUrl = new URL('../generated/synthetic-package-recipes.json', import.meta.url);

const ESBUILD_PACKAGE_JSON = JSON.stringify(
  {
    name: 'esbuild',
    version: '0.28.0',
    main: './lib/main.cjs',
    module: './lib/main.cjs',
    type: 'commonjs',
    exports: {
      '.': {
        import: './lib/main.cjs',
        require: './lib/main.cjs',
        default: './lib/main.cjs',
      },
    },
  },
  null,
  2,
);

const ESBUILD_MAIN_CJS = `const esbuild = globalThis.__rifty?.esbuild;
if (esbuild == null) {
  throw new Error('rifty invariant: esbuild runtime slot is not initialized');
}
module.exports = esbuild;
`;

export function buildSyntheticPackageRecipes(): unknown {
  const recipe = {
    substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
    publicName: 'esbuild',
    version: '0.28.0',
    runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
    kind: 'synthesized-shadow-delegate',
    dependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
    bin: {},
    files: {
      'lib/main.cjs': ESBUILD_MAIN_CJS,
      'package.json': ESBUILD_PACKAGE_JSON,
    },
  } as const;
  return [
    {
      ...recipe,
      recipeSha256: createHash('sha256').update(canonicalJson(recipe)).digest('hex'),
    },
  ];
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== '--write' && mode !== '--check') {
    throw new Error('usage: generate-synthetic-package-recipes.ts --write|--check');
  }
  const expected = `${JSON.stringify(buildSyntheticPackageRecipes(), null, 2)}\n`;
  if (mode === '--write') {
    await writeFile(outputUrl, expected);
    console.log('synthetic package recipes: wrote generated/synthetic-package-recipes.json');
    return;
  }
  const actual = await readFile(outputUrl, 'utf8');
  if (actual !== expected) {
    throw new Error('synthetic package recipes drifted; run recipe generator with --write');
  }
  console.log('synthetic package recipes: current');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
