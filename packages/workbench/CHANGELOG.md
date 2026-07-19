# Changelog

## [Unreleased]

### Added

- Existing Eddy package-acquisition config now selects npm-client's builtin
  runtime-asset batch source inside the owner; STD fallback and one
  manager/store/writer remain unchanged (ADR-0299).

- Initial sealed Workbench root, Playground companion, and five explicit worker
  deployment entries (ADR-0263, ADR-0282).

### Fixed

- Vite 7 installs now consume the public `esbuild@0.28.0` synthesized delegate
  and its exact runtime-asset plan; active fixtures no longer depend on the
  retired `@esbuild/wasi-preview1` alias package (ADR-0298).
- Route the package root through the repository-wide `src/index.ts` public seam;
  owner construction fault proof now runs the real ephemeral ownership graph
  through its Worker-IPC seam instead of replacing Workbench and rifty modules.
- Removed the host esbuild WASM URL and package dependency from the public
  Workbench seam. Node-entry v2 now admits a verified shadow-asset capability
  for every Vite 7 CLI mode, including info flags, before import; Vite 8 opens
  no capability.
- Attest dependency-free installs as runtime-asset `not-required` before child admission.
- Bundle TypeScript's browser host dependencies into published worker entries so
  consumers need no Playground-only aliases.
