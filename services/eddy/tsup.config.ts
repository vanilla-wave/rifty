import { defineConfig } from 'tsup';

// Hand-authored: eddy is a Node service, not part of the packages/* publish
// generator (tools/publishing/sync-publish-config.mjs). Bundles the library
// entry + the `eddy` CLI to ESM; first-party @riftydev/* deps stay external
// (installed alongside, the npm-package model), node: builtins stay external.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    bin: 'src/bin.ts',
  },
  format: ['esm'],
  dts: { entry: { index: 'src/index.ts' } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  external: [/^@riftydev\//, /^node:/],
});
