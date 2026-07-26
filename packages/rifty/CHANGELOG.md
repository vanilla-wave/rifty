# Changelog

## [Unreleased]

### Added

- **`@riftydev/sdk/ts-language-service`** — subpath re-export for `@riftydev/ts-language-service`.

- **ADR-0131 — `sandbox.fs` for AI-agent file IO.** `createSandbox()` now exposes
  the runtime Worker-backed `fs.readFile()` / `fs.writeFile()` surface while
  keeping `sandbox.runtime` unchanged. PR #21 review: TSDoc now states the two
  load-bearing gotchas — `fs` paths anchor at the VFS root (not the guest cwd
  `/workspace`), and `sandbox.vfs` reports the PAGE-realm backend probe while
  the runtime Worker's backend can independently fall back to memory.

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

- Corrected Vite host-wiring examples to use a production-emitted
  `@riftydev/runtime-js/worker?worker&url` asset with an ESM Worker build instead
  of an indirect package URL that Vite could not bundle.
- Clarified the SDK README host-wiring boundary: consumers still own COOP/COEP
  headers, bundler-resolved runtime Worker URLs, bundled same-origin `sw.js`
  from `@riftydev/service-worker/sw`, and same-origin WASM assets for
  sqlite/WASI use.
- Documented the SDK trust model and current resource-control limits; no runtime
  behavior changed.
