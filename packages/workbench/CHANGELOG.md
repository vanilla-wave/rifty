# Changelog

## [Unreleased]

### Added

- Initial sealed Workbench root, Playground companion, and five explicit worker
  deployment entries (ADR-0263, ADR-0282).

- Preserve main's ADR-0307 v4 install claims and host-supplied esbuild WASM URL
  through the extracted owner and child bootstraps.

### Fixed

- Fence Vite run retirement on the shared preview-route revocation proof, while
  reporting one causal close failure once.

- Keep recursive `execSync` and `worker_threads` launches in the active
  project's public filesystem namespace across owner and dev-server realms
  without exposing its physical root.
