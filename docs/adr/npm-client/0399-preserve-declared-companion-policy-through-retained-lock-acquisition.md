# ADR 0399: Preserve declared companion policy through retained-lock acquisition

Status: Accepted
Date: 2026-09

## Context

Goal I1/I3 requires the public producer to consume an ordinary npm lock and
run the already-supported Vite project. Original npm rollup4.63.1 and
vite7.3.6 locks fail EBROKENLOCK at @rollup/wasm-node; native npm ci/Vite build
passes. esbuild0.28.0 and a real rifty-authored companion lock pass. Independent
DEC-2 probes and versioned commands:
docs/backlog/distribution/reference/workbench-snapshot-companion-decision.md.

The registry-owned internals shim declares a same-version companion, but its
injected request loses that origin when the trigger came from a caller lock.
Both installer source choice and Eddy's no-I/O analysis classify it as an
ordinary missing child. Producer admission also lacks its scoped permission.

## Decision

1. Preserve the finite registry-owned companion declaration. Its issued request
   carries explicit policy origin into the existing shared incremental-source
   decision; never relabel a retained parent as metadata. Installer traversal
   and Eddy analysis use the same classification. Required ordinary missing
   children remain strict replay errors.
2. An absent declared companion may acquire real metadata/tarball bytes through
   the configured registry at the required trigger version. Existing matching
   pins reuse their real source/integrity. Nested placement/walk-up selection,
   source pin identity, bin suppression and shim version checks remain under
   their existing authorities. No public option or alternate resolver.
3. Producer admission permits a newly added companion only when its actual
   installed parent/path/version proves that finite declaration. Use existing
   path/projection authorities; a companion name or prefix alone proves nothing.
   An existing companion or ordinary entry must still match caller
   path/version/resolved/integrity. Ordinary transitive children receive no
   addition exemption. A path also demanded as an ordinary dependency cannot
   use its companion role to excuse a missing caller pin. Reuse the existing
   companion/ordinary-demand authority. No caller file or synthetic lock entry
   is written.
4. Partially supersede ADR-0188's pre-shim-lock missing-companion rejection;
   keep its same-version, nested, shim and provenance semantics. Partially
   supersede ADR-0387's new-path allowlist to include these verified declared
   companions. ADR-0023 retained pins, ADR-0384 registry ownership and ADR-0361
   exact recipe admission remain. Registry-free misses still fail under ADR-0398.

## Alternatives

- Explicit companion origin at the existing source decision plus scoped output
  permission: minimal interface; fixes the independently reproduced source and
  admission refusals, including the Eddy sibling.
- Move Rollup into an exact substitution catalog: current support is a dynamic
  same-version ^4 family. One recipe narrows it; a dynamic recipe model is
  additional machinery this repair does not require.
- Install from scratch then compare: re-resolves retained ordinary pins against
  current metadata and rejects legitimate old caller locks. Loses the existing
  lockfile selection authority.
- Require caller WASM pins, synthesize lock entries or fake metadata parent
  origin: obscures the required runtime policy and violates caller-pin/source
  fidelity.

## Fault class and proof

Sibling-drift at owned policy/graph projection: the retained parent must not
hide a policy-issued edge. Sweep covers installer source, Eddy analysis,
producer permission and nested/bin/shim consumers. Corrupt declaration/path/
version and source identity must reject; direct value projection has no
transport loss/duplication/reordering (fault-classes boundary table).

REDs use original npm locks/tarballs, retained and nested companion pins,
unrelated ordinary misses and unauthorized child additions; old checking
criteria change only with this scoped supersession and independent PR-4 review.
Mandatory packed producer Vite build/dev proof closes the user scenario.
