# ADR 0417: Open no-COI projects without installation status

Status: Accepted
Date: 2026-09

Open actual saved files; snapshot application is an explicit operation, not a
certificate of installation state.

## Context

Refining SDK #327–329, the user rejected incomplete-install-required admission:
«Среда не должна знать статус установки … Если не получается поставить
вываливается ошибка … флаг форса … перетри все что будет мешать».
Raw answer, native Node probe and independent `/root/sdk_open_decision`:
docs/backlog/distribution/reference/no-coi-project-open-refine.md.

## Decision

- SDK saved opening neither checks nor establishes installation completion.
  Missing/pending/old proof cannot block readable files or independent Node
  execution. Missing/corrupt lock or unusable adapter facts grant no adapter
  capability; errors surface at actual dependency/adapter use. No automatic
  install, snapshot reapplication, repair or obligatory retry.
- Snapshot application is an explicit operation, including first materialization
  and later updates. Host chooses when to invoke it, without keeping an install
  stamp. Ordinary open does not fetch/apply an unused artifact or infer freshness
  from absent proof. Preserve existing registry-backed install calls.
- Reuse producer format, bounded acquisition, full source/runtime/replay checks
  and generic payload conflict preflight. Default conflict rejects before
  payload/cache effects; optional force overwrites conflicting targets, including
  descendants of a directory replaced by a file. Other paths remain. Force
  bypasses neither integrity/compatibility checks nor storage failures. Exact
  API spelling belongs to pickup; no new archive format or dependency resolver.
- Apply result describes that operation: required writes/persistence settle
  before success, errors reject. Interruption may leave a partial dependency
  tree; ordinary saved access still works. No persisted installation-completion
  ledger, automatic retry or new rollback guarantee. Existing operation ownership,
  native storage recovery and truthful persistence failure reporting remain.
- Adapter preparation uses validated runtime facts, not an install-status gate.
  Preserve the existing decoder and real runtime adapters; no fake binding or
  eager refusal that merely relocates the saved-open gate.
- Supersede ADR-0392's required saved-install certification and
  missing/pending/old/mismatched-proof → explicit-install-required policy for SDK
  open, including the old-version mandatory reinstall consequence. Its stamp
  demote/promote protocol is not inherited as SDK admission/completion tracking.
  Preserve nonmutating/network-free open, install-only durable equality and
  protected claim handling wherever retained consumers require it.
- Supersede ADR-0415's retained ADR-0392 exception only for that proof-required
  SDK gate. Its Workbench access, storage/catalog recovery and rollback remain.
  ADR-0394 catalog receipts/transactions are not requirements for this new SDK
  consumer; retain its existing Workbench guarantees and payload conflict policy.
  Reuse ADR-0398's absent registry capability/local replay, without importing
  Workbench installation admission into ordinary SDK access.

## Alternatives

- Persist incomplete status and require retry before open: contradicts the
  user's ordinary-ecosystem behavior and the executed independent-Node probe.
- Attach SDK to Workbench catalog rollback: adds transaction ownership for an
  unrequested guarantee. The shared snapshot helper already separates source
  validation/preflight/cache/overlay from catalog rollback.
- Explicit apply plus ordinary saved access: selected. Existing SDK operation,
  VFS, installer and adapter owners remain; no second status protocol.

## Consequences

Native Node v24.16.0 runs local source despite an invalid lock and absent manifest
dependency; requiring that dependency fails MODULE_NOT_FOUND. After interrupted
application, dependency files may mix old/new bytes. Open promises access, not a
successful future build. Explicit install/apply may be run again; optional force
handles conflicting payload paths.

Policy only, not implementation proof. Public SDK contracts and real no-COI
browser/OPFS interruption tests precede shipping. No changes to Workbench dirty
UI, SQLite, command Stop, namespace migration or guest isolation.
