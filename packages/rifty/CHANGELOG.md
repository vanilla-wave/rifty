# Changelog

## [Unreleased]

### Added

- **ADR-0071 — umbrella `rifty` package (EPIC B).** One-install front door over
  the `@rifty/*` scope.
  - **B1 — subpath re-exports.** `rifty/vfs`, `rifty/io`, `rifty/kernel`,
    `rifty/runtime` (→ `@rifty/runtime-js`), `rifty/wasi` (→ `@rifty/runtime-wasi`),
    `rifty/net`, `rifty/npm-client`, `rifty/shell`, `rifty/terminal`,
    `rifty/service-worker`. Each re-exports the matching package verbatim, kept
    `external` at build time so the singleton state in io/kernel/vfs is shared,
    not duplicated (ADR-0070 D4, DD-1).
  - **B2 — `createSandbox(options)` façade.** Framework-free boot pipeline
    (capabilities → COI guard → VFS backend with memory fallback → service-worker
    registration → runtime worker) returning a live `RuntimeController`. The
    host-specific `workerUrl`/`serviceWorkerUrl` are inputs (EPIC E owns the
    template that produces them). Unit-testable via the `SandboxDeps` seam.
  - **B3 — `checkCapabilities()`.** Preflight gate wrapping runtime-js
    `detectCapabilities`.
