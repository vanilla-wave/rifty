# Map — self-hosted-snapshot-workbench

## Items

1. `distribution/workbench-operation-budgets` — public effective boot/file/tool
   budgets, then composed packed-host proof of the whole scenario including
   installed-tarball produce/restore (I7, remaining I1 packed residual).

## Open questions

- No currently identified observable forks after rounds 2/3. The user owns any
  newly discovered scope choice; it cannot be settled silently during pickup.
- F1: environment-owned registry access. F2: default initial-only/saved-state
  priority plus explicit apply. F3/F4: generic overwrite/error conflict policy,
  independent of snapshotId or package/dependency meaning.

## Existing authorities

- Snapshot compatibility/identity: Workbench dep-snapshot and package-acquisition authority
  (ADR-0261/0346); application policy selects effects before acquisition and
  catalog reseed. It owns conflict resolution; neither catalog nor installer
  invents an independent update policy. Existing transaction/acquisition owners
  execute selected effects, without a second installer or write coordinator.
- Storage/recovery: paired OPFS backend + owner catalog transaction authority
  (ADR-0072/0279/0401/0403/0404); both storage children share those existing
  owners. I4 landed: optional `storage.namespace` bounds paired preload/writes.
  I6 landed: unjournaled Scratch is retained for download beside fresh Scratch.
- Preview addressing: io preview-protocol and existing SW bridge; I5 landed
  optional `deployment.previewPrefix` as the one prefix authority across HTTP
  and HMR (ADR-0405).
- Timeouts: existing owner port, VFS commit coordinator and tool transport;
  configure their budgets without adding another timeout/retry coordinator.

## Out of scope

- Builder-owned private-registry authentication; access belongs to the host environment.
- Arbitrary externally installed node_modules archive admission, cache/tree
  deduplication, and a new all-project import API. Existing duplicate-byte
  research stays in playground/snapshot-carries-substituted-bytes-twice.
- Automatic storage migration, multiple concurrent Workbench owners, eviction
  guarantees, and a new recovery UI (public retained-byte API is included).
- Lifecycle-script policy changes, public progress/preflight API, streaming
  restore implementation, larger snapshot limits, and private-package compatibility.
- No-COI SDK changes, React bindings and the existing ready embeddable-dev-loop
  destination. Its registry-backed reference host is not replaced.
- Publishing/deploying runtime packages during this documentation task.
