# Changelog

## [Unreleased]

### Added

- Existing Eddy package-acquisition config now selects npm-client's builtin
  runtime-asset batch source inside the owner; STD fallback and one
  manager/store/writer remain unchanged (ADR-0299).

- Initial sealed Workbench root, Playground companion, and five explicit worker
  deployment entries (ADR-0263, ADR-0282).

### Fixed

- Exact Vite 7.3.6 and 8.0.16 acquisition transforms now redirect only bundled-config
  temp-file backing to an owner-private lexical capability. Vite retains upstream
  bundle, naming, URL, import, and cleanup order; version, path, or anchor drift
  loud-throws before install promotion. Direct and dev-server children receive
  separate project-scoped generations that close before package quiescence.
- Runtime-asset lifecycle contracts now use one integrity-checked vendored
  upstream tarball instead of reconstructing source bytes with environment-dependent
  `npm pack` output.
- Privileged Node and dev-server bootstraps now consume entry capability ports
  before importing ordinary VFS guest code; unused and unknown endpoints close
  before handoff instead of remaining recoverable through an ambient global
  (ADR-0300).
- Recursive program entries now classify the two canonical installed Vite CLI
  paths before guest import. An unadmitted Vite 7 child loud-throws
  `vite.esbuild.shadowAssets` instead of bypassing the non-inherited capability.
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
