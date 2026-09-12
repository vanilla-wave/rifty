# ADR 0420: Apply no-COI snapshots through the SDK

Status: Accepted
Date: 2026-09

## Context

PR #332 goal I3–I6, policy ADR-0417. Published producer format and bounded
snapshot application already exist; the SDK lacks their consumer.

## Decision

- `sandbox.toolchain.applySnapshot({ cwd, snapshot: { assetUrl, snapshotId,
  templateId }, force? })` applies explicitly. No registry URL or install ledger.
- Reuse full bounded acquisition, decompressed snapshot identity, runtime identity,
  replay validation, prepared payload validation and generic overlay preflight.
  `force: true` selects existing overwrite policy; default selects conflict error.
  Same-ID input passes all validation again. Actual persistence settles success.
- `open({ cwd, registryUrl? })` opens saved files. Optional legacy registryUrl is
  validated but not used for acquisition/admission. Existing install is unchanged.
- Derive adapter bindings only through the existing saved-lock decoder; missing
  or invalid lock grants none. Reuse `preparePackageEntryRuntime` to preserve
  concrete adapter failure until actual package use. Ordinary access never checks
  install stamps, flushes an earlier failed operation, or rewrites project files.
- Keep the existing Worker operation owner and recovery snapshot. Explicit apply
  joins its busy/resident admission; no new coordinator or crash rollback.

## Alternatives

- New installation certificate/catalog wrapper: contradicts ADR-0417/I4/I6.
- Host-side archive parsing or placeholder registry: contradicts I3.
- Existing application helper and entry preparation: selected; minimal API,
  identical source/integrity/conflict and point-of-use owners.

## Proof

Native no-COI saved-access/snapshot-application cases; packed public producer →
SDK/copied Worker Vite build/edit/reopen/update/interruption/quota journey.
