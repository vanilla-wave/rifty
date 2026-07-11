# Changelog

## [Unreleased]

### Added

- Framework-free browser workbench session controllers for boot/teardown, PTY
  terminal I/O, shell and npm commands, proven preview state, editor-to-VFS
  synchronization, and watched file-tree mutations (ADR-0224).
- Host-injected Worker, service-worker, WASM, and registry configuration; one
  active session per page with loud browser-capability and concurrent-boot
  failures.
- Protected node-worker bootstrap config is installed at one validated boundary
  and survives Node-compatible user `env` replacement (ADR-0231).
- Owner, kernel, Node, and dev-server Worker entry points for hosts to bundle;
  project templates/starters cross the package boundary as a validated,
  serializable catalog instead of playground imports.
- Protocol-agnostic owner extension messaging with readiness/refusal semantics;
  the playground's TS language-service child relay remains app-owned.
- Live PTY resize propagation from a host terminal through the owner and kernel
  control plane to Node TTY dimensions and `SIGWINCH`.
- Ordered foreground stdin forwarding from `TerminalController.write()` through
  the owner PTY into supervised Node and `.bin` workers; flowing non-TTY
  `process.stdin` data/UTF-8 decoding works while pull/raw ceilings stay loud
  (ADR-0230).

### Changed

- Framework-free glue, owner-worker boot, and orchestration moved from the
  Solid playground into this package with their behavioral tests; the
  playground consumes the same package core beneath the embedder controllers
  instead of keeping a sibling copy.
- Embedder and Playground flows share owner durability/mutation coordination,
  preview route ownership, and the public terminal controller rather than
  maintaining parallel stateful implementations.
- Re-entrant `boot()` calls from synchronous status subscribers now reuse the
  already-published in-flight boot instead of starting duplicate owners.
- Preview LIVE provenance now requires a version-matched ping/pong from the
  controlling rifty service worker before the routed HTTP proof can run.
- Workspace ids use injective path-segment encoding, and public project roots
  cannot expose the profile-wide `/.rifty` metadata namespace.
- Host callback faults no longer interrupt sibling notifications or runtime
  state; session, PTY, preview-route, owner-bridge, and partial-setup teardown
  attempts every cleanup step before reporting an aggregate failure.
