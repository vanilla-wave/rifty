import { defineConfig } from 'tsup';

// Hand-authored: eddy is a Node service, not part of the packages/* publish
// generator (tools/publishing/sync-publish-config.mjs). It is STANDALONE, so we
// bundle the first-party @riftydev/* deps (and their third-party deps) INTO dist
// — `node dist/bin.js` (the Docker image + `npx @riftydev/eddy`) is then fully
// self-contained: no runtime dep resolution, and no dev-src-vs-dist manifest
// hazard (`pnpm deploy` does NOT apply publishConfig, so an externalized
// @riftydev/* would resolve to its TS source at runtime and crash). Only node:
// builtins stay external.
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
  noExternal: [/^@riftydev\//],
  external: [/^node:/],
});
