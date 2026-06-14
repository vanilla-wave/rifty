# @riftydev/workbench

## Unreleased

- **ADR-0139 — initial headless workbench controller package.** Adds
  `createRuntimeSession`, `createPreviewBinding`, `createEditorSync`, lifted
  editor/preview/npm/template helpers, and default session config that only
  requires a host-provided `bootstrapWorkerUrl`.
- Adds `@riftydev/workbench/project-worker` with `runProjectWorker()` so the
  default worker runtime no longer lives in the playground.
- Adds headless terminal session/persistence controllers for non-Solid hosts.
- Adds `RuntimeSession.ready` so consumers can wait for worker-side bridges
  instead of parsing terminal logs.
