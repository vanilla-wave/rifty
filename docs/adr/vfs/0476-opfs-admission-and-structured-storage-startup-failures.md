# ADR 0476: OPFS admission and structured storage startup failures

Status: Accepted
Date: 2026-09-28
Partially supersedes: ADR-0372 decisions 1 and 3 (sync capability sufficiency)

## Context

ADR-0469 and browser-support-floor I3/I4 require honest storage admission.
Sync handles without `createWritable` passed selection but failed the first
durable write; root denial became a misleading Worker crash / NotImplementedError.
P1/P2 and executable RED: `docs/backlog/vfs/reference/browser-support-storage-evidence.md`.
Independent DEC-2 review supported this partial correction before implementation.

## Decision

- `OpfsFsSync.isSupported()` remains the realm-local authority: Worker + callable
  `createSyncAccessHandle` + callable `createWritable`. Both paired write paths
  need the latter; detect before namespace creation or writes. COI irrelevant.
- Required missing capability rejects startup with `StorageCapabilityError`,
  code `ERR_STORAGE_CAPABILITY`, naming `FileSystemFileHandle.createWritable`.
  Preferred/default use existing visible memory fallback; ephemeral bypasses OPFS.
- Configured root/namespace acquisition failure becomes `StorageUnavailableError`, code
  `ERR_STORAGE_UNAVAILABLE`; message and `cause` retain native name/message.
  Legacy `initBackend()` without storage options retains native errors.
  Preload failure remains distinct. These are observable SDK error identities;
  no exported constructor or new package dependency.
- Failed toolchain boot uses its existing `toolchain-terminal` frame, host
  termination and pending-call rejection. Error serialization retains one native
  cause's name/message; no new lifecycle, retry or handshake protocol.

ADR-0372 decisions 2, 4–6 stay: async presence cannot select a paired backend;
capability does not prove permission/durability; no new persistence mechanism.

## Alternatives

Late write failure violates I3. Probe writes add admission side effects.
Replacing the writer with sync handles is excluded by the user's Safari scope.
