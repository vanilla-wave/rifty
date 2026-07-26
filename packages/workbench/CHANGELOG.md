# Changelog

## [Unreleased]

### Added

- Initial sealed Workbench root, Playground companion, and five explicit worker
  deployment entries (ADR-0263, ADR-0282).

- Dispatch admitted runtime bindings by recipe `adapterId` before guest entry.
  Direct CJS/ESM esbuild and Vite 7 consume the same registry-attested bytes;
  Vite 8 keeps an empty plan, and the `esbuild` bin fails loudly as
  `NotImplementedError('esbuild.cli')` (ADR-0308/0311). Capability endpoints
  ride the kernel's one-shot URL-entry descriptor and are consumed before guest
  import; generic runtime-js entries and process-visible IPC stay unchanged
  (ADR-0313).

### Changed

- Regenerated install-artifact identity now binds the schema-2 builtin shadow
  catalog, invalidating stale worker install stamps after the policy authority
  change (ADR-0328).
- Removed dead zero-caller surface: `installStampAuthorityFor` + its
  `ownerAuthorities` registry and the two unused owner-VFS terminal equality
  helpers; module-surface tests pin their absence.

- Remove the public host-supplied esbuild WASM deployment URL. Worker and
  sqlite deployment assets remain host-resolved; esbuild is now registry-owned
  with no host fallback (ADR-0311).

### Fixed

- Abort a terminal install waiter immediately when its lifecycle closes behind
  the package FIFO head, while retaining its cancelled admission until that
  FIFO position so quiescence and stamp ownership stay exact.

- Preserve the exact owner outcome of file mutations admitted before project
  close; close drains those commits while fencing future and unhanded work
  (ADR-0319).

- Extend the generic runtime-adapter boundary to every owner admission/asset/
  controller module and move the concrete runtime projection into its existing
  owner-protocol seam.

- Keep the already-published live package tree available to Node after a
  manifest-only edit while demoting its durable install claim; real tree
  mutations still revoke admission, and empty trees are re-attested.

- Register installed `vite preview` listeners as the production-preview source
  from owner-trusted CLI mode, with launch-scoped teardown that cannot clear a
  newer preview.

- Match npm 11 non-workspace prefix discovery for typed
  `package.json`/`node_modules` markers and stat misses; selected or ancestor
  workspace roots now throw before package or lifecycle mutation instead of
  conflating npm's root lock/tree prefix with its selected member target.

- Admit Node children across exact package-tree ancestry: deferred plans
  replace stale facts only after exact empty proof, byte-exact install
  rollbacks recover, every child ingress reserves its concrete entry, nested
  roots retain ancestor runtime bindings, structural tree replacements stay
  fenced without serializing exact sibling work, and partial/torn trees stay
  blocked.

- Abort an active npm acquisition from the owning terminal/project lifecycle;
  package admission remains held until the cancelled install actually settles.

- Keep live-owner Project VFS snapshot and atomic reads pending until the exact
  reply; only failed admission or confirmed owner death settles them.

- Fence Vite run retirement on the shared preview-route revocation proof, while
  reporting one causal close failure once.

- Keep recursive `execSync` and `worker_threads` launches in the active
  project's public filesystem namespace across owner and dev-server realms
  without exposing its physical root.
