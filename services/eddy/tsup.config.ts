import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// The @riftydev/npm-client version eddy bundles, injected at build time. The
// self-contained bundle inlines npm-client (no on-disk package to `require.
// resolve`), so the runtime lookup in src/npm-client-version.ts can't find it;
// this `define` feeds it the real version for the skew-audit header (ADR-0182).
const npmClientVersion = (
  JSON.parse(
    readFileSync(new URL('../../packages/npm-client/package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

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
  define: { __EDDY_NPM_CLIENT_VERSION__: JSON.stringify(npmClientVersion) },
});
