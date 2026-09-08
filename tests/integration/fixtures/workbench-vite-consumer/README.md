# Packed Workbench Vite consumer

External browser host that imports only published package subpaths. The
acceptance lane packs the Workbench dependency closure, installs every package
from local tarballs, builds this fixture, and runs the production output in a
fresh Chromium process.

The journey opens real Vite 7.3.6 from a loopback registry, proves preview and
native HMR, and executes `node:sqlite`. The host copies `@riftydev/workbench/dist/runtime/` to `/runtime/` and
passes those URLs to `openWorkbench`. It compiles no Worker/SW entries
and writes no builtin-alias file or QuickJS wrapper. esbuild runtime
bytes come only from the admitted shadow-registry capability.

TypeScript still checks the consumer sources and all imported public shapes.
`skipLibCheck` isolates a documented pre-existing `@riftydev/io` declaration
inheritance conflict from this Workbench distribution oracle.

Run from the repository root:

```sh
pnpm test:packed-consumer
```
