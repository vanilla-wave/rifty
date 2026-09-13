# ADR 0432: Report excluded storage layouts through existing health and startup diagnostics

Status: Accepted
Date: 2026-09

## Context

PR #299 I3 and Outcome (d): excluded legacy data or corrupt replica must take a
named cold-restore path. ADR-0425 supplies the diagnosis; owner proof can replace
corrupt HEAD before the page sees it. Independent DEC-2: /root/replica_decision,
2026-09-13, existing authorities and boot paths inspected.

## Decision

- Partially supersede ADR-0285's exhaustive degraded-scope list and retry-only
  clause. Add exactly `degraded/storage-layout`, `recovery: 'none'` to existing
  health. No new recovery scope. Operational recovery and protocol-fatal rules stay.
- Owner readiness captures a fixed public summary by diagnosis kind; existing
  owner health subscription replays it into one global slot in the existing
  authority. No raw error, owner path/token or second notification channel.
  Notice survives project switches; informational degradation preserves ADR-0413
  opening progress. Playground renders summary without Retry/Reload.
- Derive legacy notice from native `/.rifty/workbench/v1` directory presence
  under the selected mount and absence of a complete current project record.
  Read only native directory metadata, never v1 contents. Existing project-store
  reader validates current metadata/tree; malformed orphan candidates are not
  completion evidence and retain their usual error when explicitly opened.
  Proof files, empty catalog and staging do not suppress the notice. No seen flag.
- Before the first mutation that can replace corrupt HEAD, synchronously record
  `{version:1,kind:'corrupt'}` at `/.rifty/workbench/v2/storage-layout.json`,
  through the ordinary VFS/replica/ledger. Parent mkdir and record write have no
  intervening await. Pre-HEAD crash retains corruption; post-HEAD crash retains
  its diagnosis. Emit while no complete current project exists. No separate
  journal, HEAD field or acknowledgment; marker does not certify readiness.
- Generic no-COI has no Workbench project-layout predicate or startup proof writes.
  Internal VFS initialization returns captured layout diagnosis; public
  `initBackend` retains its backend-string result. Worker posts canonical existing
  stderr immediately after initialization, before further awaits/ready. SDK
  captures startup stderr from spawn through ready via existing `options.logger`;
  no public protocol/API addition, no relabeling Memory fallback reason.
- Acquired-state native I/O failures remain failed opens. Only diagnosed legacy
  exclusion or deterministic corruption qualifies for informational cold restore.

## Alternatives

Separate toast/API loses health replay and duplicates authority. Persistence
retry cannot recover excluded bytes; protocol-fatal would terminate a valid
owner. Delaying storage proof changes the proven readiness guarantee. An ordinary
logical diagnosis record preserves custody within the existing publication point.

## Consequences

Legacy projects/edits/npm installs/clones/git history are not carried over; native
v1 bytes remain. The notice names legacy per-file OPFS v1, never reconstructed
project names. Corrupt native data is not adopted as project state. Actual new
project materialization suppresses the notice on subsequent opens.
