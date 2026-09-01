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
- `no-coi-toolchain-worker` — one-Worker SDK build-loop entry for explicit
  shared-memory-free mode.

Controllers, owner transports, worker protocols, and `src/internal/*` are not
public. Browser hosts supply Worker, Service Worker, and WASM URLs; package code
contains no bundler query imports or App policy.

See ADR-0263 and ADR-0282.
