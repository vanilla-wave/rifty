# Changelog

## [Unreleased]

### Added

- Initial sealed Workbench root, Playground companion, and five explicit worker
  deployment entries (ADR-0263, ADR-0282).

- Preserve main's v3 install stamps and host-supplied esbuild WASM URL through
  the extracted owner and child bootstraps.

### Fixed

- Keep recursive `execSync` and `worker_threads` launches in the active
  project's public filesystem namespace across owner and dev-server realms
  without exposing its physical root.
