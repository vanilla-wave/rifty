# ADR 0139: Workbench headless controllers package

Status: Accepted
Date: 2026-06

> TL;DR: add `@riftydev/workbench` as the framework-free headless controller
> package; default runtime sessions require only a host-provided Worker URL

## Context

M11's embeddable story needs more than low-level `@riftydev/sdk` boot. External
hosts need the playground's editor-sync, preview routing, HMR bridge,
node_modules browsing, npm-shell, project-template, and real-project session
logic without importing from `apps/playground` or adopting Solid.

`docs/backlog/distribution/workbench-controllers.md` parked EPIC C until a
non-Solid consumer was pulled. This task is that pull signal. The app-local
`apps/playground/src/glue/*` modules were already mostly framework-free and
several were explicitly waiting for a second consumer before promotion.

New package + public controller API is irreversible by
`docs/process/decision-workflow.md`.

## Decision

- Add `packages/workbench`, published as `@riftydev/workbench`.
- Keep it framework-free. No `solid-js`, Monaco, xterm, `apps/*`, or playground
  UI imports. Dependencies are framework-free rifty packages only.
- Root exports are the public surface. Primary controllers:
  - `createRuntimeSession({ bootstrapWorkerUrl, ...optional })`
  - `createEditorSync({ session, ... })`
  - `createPreviewBinding({ session | port })`
  - `createTerminalManager(...)` / `createTerminalPersistence(...)`
- Add `@riftydev/workbench/project-worker` for the default Worker-side project
  runtime (`runProjectWorker`). The playground keeps only the bundler-resolved
  asset wrapper (`?worker&url`, `sql.js` wasm URL); the runtime, default
  esbuild/rollup shims, VFS bridges, install path, preview bridges, and HMR
  dispatch live in the package.
- The default API is intentionally small. `bootstrapWorkerUrl` is the only
  required default option because package code cannot know a host bundler's
  emitted Worker asset URL. Defaults are: Vite template, `/workspace`,
  template entry, template port, `setup: 'instant'`, slug = template id, no-op
  logging.
- Move headless playground glue/templates into workbench: sync-mirror VFS,
  HMR bridge, preview bridge wiring, VFS write/snapshot ports, lazy
  node_modules reads/cache, npm shell command, install stamp, dependency
  snapshots, project dependency arrival, workspace archives, file tree/fs ops,
  and project templates.
- Keep host/UI/build concerns in the playground: Solid adapters/components,
  Monaco worker setup, xterm visual helpers, clipboard/layout utilities, and
  the actual `workers/real-vite-bootstrap.ts?worker&url` asset import.
- Add `@riftydev/sdk/workbench` as a thin subpath re-export for one-install
  consumers.

## Consequences

- External UIs can wire rifty sessions without importing from
  `apps/playground`.
- The playground becomes a thinner binding layer over the same headless package
  external users consume.
- Publishing set grows by one package; release docs and publish SPEC must count
  it.
- `createRuntimeSession` still needs a host worker asset URL, but the default
  worker implementation is package-owned; consumers usually write a tiny worker
  file that calls `runProjectWorker()`.
