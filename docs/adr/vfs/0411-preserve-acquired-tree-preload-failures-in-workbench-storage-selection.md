# ADR 0411: Preserve acquired-tree preload failures in Workbench storage selection

Status: Accepted
Date: 2026-09-09
Supersedes in part: ADR-0406 best-effort preload; retains its unavailable-cache read/copy rule.

## Evidence

PR316/main composition combines ADR-0393 strict single-pass preload with
ADR-0406 missing-cache honesty. Native required/preferred getFile and arrayBuffer
probes: required rejects; preferred incorrectly reports an empty memory owner.
Evidence: docs/backlog/distribution/reference/pr316-completion-repair-evidence.md.
Independent DEC-2 research: snapshot_preparation_decision; both ADRs and goal
I4/I6/I8 checked. Source-read failure cannot authorize fresh saved-project state.

## Decision

Keep ADR-0393 single traversal and all-or-error publication for init and explicit
preload. Workbench storage selection rethrows OpfsPreloadError for either policy.
Root/namespace acquisition refusal and existing storage-proof failure retain
required rejection/preferred visible fallback. Ephemeral behavior is unchanged.

Preserve ADR-0406 shared EIO read/copy check, real cached-empty distinction,
copy error order, uncached rename custody and write healing. Cold-cache tests
use an actual metadata-only mirror; they no longer require successful boot after
a failed preload. No second error ledger, partial-ready mode or preload policy knob.

## Alternatives

- Keep per-file best-effort boot: conflicts with accepted main ADR-0393; permits
  incomplete saved state to reach runtime admission.
- Fall back to memory after acquired-tree failure: erases the observable saved
  project despite physically retained bytes; violates I8.
- Existing typed preload error and strict publication: selected; preserves both
  namespace/budget configuration and the known source-byte custody rule.

The accepted goal is unchanged. Native tests preserve exact selected/outside bytes,
rejection reasons, retry, root-conflict and durability-proof fallback controls.
