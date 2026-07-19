# Changelog

## [Unreleased]

### Added

- Initial sealed Workbench root, Playground companion, and five explicit worker
  deployment entries (ADR-0263, ADR-0282).

### Fixed

- Removed the host esbuild WASM URL and package dependency from the public
  Workbench seam. Node-entry v2 now admits a verified shadow-asset capability
  only for Vite 7 preparation; Vite 8 opens no capability.
- Attest dependency-free installs as runtime-asset `not-required` before child admission.
- Bundle TypeScript's browser host dependencies into published worker entries so
  consumers need no Playground-only aliases.
