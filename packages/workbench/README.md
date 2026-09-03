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
- `no-coi-toolchain-worker` — one-Worker SDK exact-manifest/install-bin entry
  for explicit shared-memory-free mode; package identity is not policy.

Controllers, owner transports, worker protocols, and `src/internal/*` are not
public. Browser hosts supply Worker, Service Worker, and WASM URLs; package code
contains no bundler query imports or App policy.

QuickJS-backed Node children require a host kernel wrapper: import the bundler's
`@jitl/quickjs-wasmfile-release-sync/wasm?url`, publish it under
`QUICKJS_WASM_URL_ENV` from `@riftydev/runtime-js/install-process`, and
statically import `@riftydev/workbench/kernel-worker`. Pass that wrapper's
emitted Worker URL as `deployment.workers.kernel`; using the sealed kernel entry
directly leaves browser QuickJS asset resolution unconfigured (ADR-0352).
Playground's `quickjs-kernel-worker-host.ts` is the reference composition.

See ADR-0263 and ADR-0282.
