# ADR-0384: Registry ownership of bundled guest-package adaptations

- Status: accepted
- Date: 2026-09-07

## Context

PR #314 accepts SDK rebuilds, all existing adaptations and optional public Vite helpers. Workbench and runtime-js currently own package policy independently. Baseline and inventory: `docs/backlog/npm-client/reference/registry-package-adaptations-evidence.md`.

## Decision

1. Registry owns finite executable adaptations through a separate `./runtime` composition entry. Data-only root and `./internal` do not import it. Dependencies point to io/VFS; host supplies keepalive. No configurable extension registry, guest delivery protocol, new cache or new startup ledger.
2. Move esbuild's generated client, installed-byte verification, callback FS and realm identity together. Registry owns the realm-shared carrier read by the installed CJS facade. Runtime-js has no package-named API/key. Preserve exact outer identity, startup-before-import, info-mode suppression, loud gaps and installed-tree/offline byte authority.
3. Registry owns installed Vite/emnapi transforms and launch/manifest compatibility decisions. Acquisition and ordinary entry paths invoke them; helpers delegate and stay compatible. Manifest overrides remain visible before project identity; caller-supplied overrides win.
4. `.vite` is an ordinary user directory in project snapshots and archives. Other exclusions and archive validation remain. Generic install/server diagnostics name the project subsystem.
5. Ownership gates inspect executable platform policy and dependency direction. Existing real-package differential/browser suites retain semantic criteria; relocation of carrier paths and realm inspection follows this ADR. Full browser and packed-consumer verification required.

## Alternatives

- Keep constants in registry, dispatch/patches in Workbench: violates I1; current source already demonstrates split ownership.
- Deliver executable installed guest client: requires another byte-delivery/lifecycle mechanism; ADR-0371 rejected it and SDK rebuilds are accepted.
- Fix general Node capabilities: retain existing generic Node/WebIDL behavior; these workarounds also contain exact upstream backports and browser-WASM client derivation. No general capability shown to replace their supported contract; preserve proven implementation.

## Corrections to active decisions

- ADR-0226 D2/D3: registry owns exact CJS realm carrier, replacing typed runtime-js slot and Workbench publisher. Other semantics unchanged.
- ADR-0371: generated client is registry-owned SDK-bundled code, replacing named Workbench-bundle exception. Installed-tree byte authority unchanged.
- ADR-0375: registry preparation serves existing COI/no-COI paths; no application-owned package policy. Generic no-COI control plane remains generic.
- ADR-0336 D1/D4: registry owns manifest compatibility policy; Workbench delegates. D2 caller priority, D3 visible serialized manifest and D5 real-package evidence retained.
- ADR-0278 archive clauses and ADR-0286 derived-directory list: remove only `.vite`; other validation/private-root/storage clauses remain.
- ADR-0361 concrete consumer edges move under registry ownership; generic transport/admission still holds.
