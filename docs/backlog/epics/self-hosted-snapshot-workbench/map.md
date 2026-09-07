# Map — self-hosted-snapshot-workbench

## Items

1. `distribution/dep-snapshot-producer` — published manifest/lock producer,
   identity output and standard tar.gz consumer proof (I1).
2. `distribution/workbench-static-assets` — copyable Worker/SW/WASM closure,
   first proven with the existing install-enabled mode (I2).
3. `distribution/workbench-snapshot-only` — registry-free admission and loud
   snapshot failure; consumes the published producer/assets (I3).
4. `vfs/workbench-storage-namespace` — opt-in isolated root, empty on first
   selection, with the old setting preserving access to old projects (I4).
5. `playground/orphan-scratch-recovery` — retain/download orphan bytes and
   open fresh Scratch, using the selected storage namespace (I6).
6. `service-worker/workbench-preview-prefix` — scoped iframe/assets/HMR routing
   on the same static host (I5).
7. `distribution/workbench-operation-budgets` — public effective boot/file/tool
   budgets, then composed packed-host proof of the whole scenario (I7).

## Open questions

- None at observable-scope altitude; standard tar.gz from the producer and
  collision-free separation are user-decided. Wire layout and exact fault rows
  belong to pickup, without reopening that scope.

## Existing authorities

- Snapshot compatibility/identity: Workbench dep-snapshot and package-acquisition authority
  (ADR-0261/0346); no second installer or restore policy.
- Storage/recovery: paired OPFS backend + owner catalog transaction authority
  (ADR-0072/0279); both storage children share those existing owners.
- Preview addressing: io preview-protocol and existing SW bridge; one prefix
  authority across HTTP and HMR.
- Timeouts: existing owner port, VFS commit coordinator and tool transport;
  configure their budgets without adding another timeout/retry coordinator.

## Out of scope

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
