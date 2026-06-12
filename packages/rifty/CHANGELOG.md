# Changelog

## [Unreleased]

### Added

- **ADR-0131 — `sandbox.fs` for AI-agent file IO.** `createSandbox()` now exposes
  the runtime Worker-backed `fs.readFile()` / `fs.writeFile()` surface while
  keeping `sandbox.runtime` unchanged.

- **ADR-0071 — umbrella `@riftydev/sdk` package (EPIC B).** One-install front door over
  the `@riftydev/*` scope.
  - **B1 — subpath re-exports.** `@riftydev/sdk/vfs`, `@riftydev/sdk/io`, `@riftydev/sdk/kernel`,
    `@riftydev/sdk/runtime` (→ `@riftydev/runtime-js`), `@riftydev/sdk/wasi` (→ `@riftydev/runtime-wasi`),
    `@riftydev/sdk/net`, `@riftydev/sdk/npm-client`, `@riftydev/sdk/shell`, `@riftydev/sdk/terminal`,
    `@riftydev/sdk/service-worker`. Each re-exports the matching package verbatim, kept
    `external` at build time so the singleton state in io/kernel/vfs is shared,
    not duplicated (ADR-0070 D4, DD-1).
  - **B2 — `createSandbox(options)` façade.** Framework-free boot pipeline
    (capabilities → COI guard → VFS backend with memory fallback → service-worker
    registration → runtime worker) returning a live `RuntimeController`. The
    host-specific `workerUrl`/`serviceWorkerUrl` are inputs (EPIC E owns the
    template that produces them). Unit-testable via the `SandboxDeps` seam.
  - **B3 — `checkCapabilities()`.** Preflight gate wrapping runtime-js
    `detectCapabilities`.

### Changed

- Clarified the SDK README host-wiring boundary: consumers still own COOP/COEP
  headers, bundler-resolved runtime Worker URLs, bundled same-origin `sw.js`
  from `@riftydev/service-worker/sw`, and same-origin WASM assets for
  sqlite/WASI use.
- Documented the SDK trust model and current resource-control limits; no runtime
  behavior changed.
