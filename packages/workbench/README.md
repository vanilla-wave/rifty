# @riftydev/workbench

Framework-free embeddable development workbench for rifty. It owns one browser
runtime authority and exposes finite project, session, run, file, document,
terminal, and preview operations.

## Public surface

- `@riftydev/workbench` — sealed generic Vite workbench.
- `@riftydev/workbench/playground` — first-party neutral project plans and
  lifetime-scoped TypeScript, SCM, archive, catalog, and terminal restoration
  tools.
- `owner-worker`, `kernel-worker`, `node-worker`, `dev-server-worker`, and
  `typescript-worker` — host-resolved deployment entries.

Controllers, owner transports, worker protocols, and `src/internal/*` are not
public. Browser hosts supply Worker, Service Worker, and WASM URLs; package code
contains no bundler query imports or App policy.

## Storage

`storage.persistence` is `required | preferred | ephemeral` (ADR-0263). An
embedder whose source of truth lives outside the browser (every open
re-materializes from a definition — baked snapshot, archive, remote tree)
should pass `ephemeral`: OPFS is never opened or proven, so open pays only
fetch + prepare + apply and reopen is the same open again; nothing survives a
reload. `required`/`preferred` are for projects whose edits must survive
reload; their storage cost on large trees is the
`docs/backlog/epics/fast-project-open-reopen` goal. Neither mode lifts
cross-origin isolation: guest `readFileSync` blocks on the SAB sync ring.

See ADR-0263 and ADR-0282.
