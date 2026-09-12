# ADR 0412: Publish prepared dependency snapshot payloads

Status: Accepted
Date: 2026-09-09
Extends: ADR-0384, ADR-0387, ADR-0394.

## Evidence

PR316 Vite7.3.6: initial restore builds; fresh and same-ID apply/overwrite
publish trusted trees whose CLI startup rejects missing acquisition preparation.
Producer output predates Vite CLI/root-watch finalization. Both browser and real
Memory VFS owner graphs reproduce it. Evidence and sibling sweep:
docs/backlog/distribution/reference/pr316-completion-repair-evidence.md.
Independent decision research: snapshot_preparation_decision.

## Decision

Registry-owned installed-file planners compute the existing Vite and pinned
@emnapi/core transformations against an explicit FsSync. Existing finalizers
apply those changes; public producer and first-party baker use the same planners
on their private filesystem before serialization. No global syncMirror switch,
new installer, startup mutation, package identity exemption or recipe change.
SnapshotId naturally changes with prepared payload bytes.

Explicit application validates readiness of the source payload before target,
cache or claim effects. An unprepared source requests rebaking and is rejected;
readers and initial restoration of legacy v3 JSON/gzip remain supported. Validation
uses the same read-only preparation planners on an isolated real Memory VFS.
Generic overlay compares and writes actual admitted payload bytes, preserving
untargeted saved paths and error/overwrite semantics exactly.

The runtime subpath exposes the read-only planners and accepts explicit filesystem
selection in existing preparation APIs. No Workbench public API or archive format
changes. Existing registry/initial restoration remain idempotently prepared;
no-COI retains generic-only finalization. Esbuild activation remains runtime-owned.

## Alternatives

- Finalize the live target after apply: can change or reject untargeted saved
  Vite/@emnapi files selected through the resulting tree; violates I8.
- Transform incoming bytes before conflict preflight: compares different bytes
  from the selected archive; violates literal application policy.
- Producer preparation alone: leaves older unprepared archives with the same
  recipe identity capable of false trusted admission.
- Prepared publication plus source-only read-only validation: selected. One
  transformation owner, no post-application rewrite and no full-tree diff owner.

## Proof

Real producer Vite readiness and concurrent-Fs isolation; literal apply/retained
foreign files; unprepared tar/JSON refusal before effects; legacy initial controls;
existing pinned emnapi transformation coverage. Packed same-project initial/edit/
saved-reopen/apply/build/dev/HMR/reopen and fresh-apply execution close the original
I3/I8 conjunction. Destination and generic conflict policy remain unchanged.
