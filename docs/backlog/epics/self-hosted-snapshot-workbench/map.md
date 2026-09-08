# Map — self-hosted-snapshot-workbench

## Items

1. `vfs/workbench-storage-namespace` — opt-in isolated root, empty on first
   selection, with the old setting preserving access to old projects (I4).
2. `playground/orphan-scratch-recovery` — retain/download orphan bytes and
   open fresh Scratch, using the selected storage namespace (I6).
3. `service-worker/workbench-preview-prefix` — scoped iframe/assets/HMR routing
   on the same static host (I5).
4. `distribution/workbench-operation-budgets` — public effective boot/file/tool
   budgets, then composed packed-host proof of the whole scenario (I7).

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
  (ADR-0072/0279); both storage children share those existing owners.
- Preview addressing: io preview-protocol and existing SW bridge; one prefix
  authority across HTTP and HMR.
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
