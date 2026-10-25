# ADR-0486: Observable sandbox startup and snapshot lifecycle

Date: 2026-09-30. Status: accepted.

## Context

Kit I1–I3 need pre-ready events and discriminable failures. Today createSandbox
returns only after handshake; native writer contention disappears behind the
host deadline. ADR-0419 startup deadlines, ADR-0428 native guard wait,
ADR-0417/0420 snapshot conflict semantics and ADR-0413 honest counts remain.

## Decisions

1. `createSandbox` returns `SandboxOpening<T>`, a Promise with readonly
   `runtime: Pick<RuntimeController, 'on'>`. Attach before awaiting; resolved
   sandbox uses the same subscription hub through restart. Promise resolution
   still means ready; invalid input still rejects asynchronously. No replay.
2. One `RuntimeEvent` progress union. Boot phases: worker-spawned after native
   construction, waiting-for-storage-writer after native contention,
   storage-admitted before hydration, toolchain-ready after handshake. A waiting
   frame carries native cause name/message. Existing startup deadline classifies
   occupied only while waiting; admission clears it. Guard expiry keeps
   OpfsPreloadError. Both preserve actual native contention cause. No new wait,
   retry, owner, lease or fallback.
3. SDK root exports `sandboxErrorKind(unknown)` and `SandboxErrorKind`:
   busy, resident-busy, occupied, snapshot-conflict, snapshot-mismatch,
   restart-busy, persistence. Structural name/code recognition survives Worker
   serialization and duplicate packages. Unknown errors stay unknown; no message
   matching. README records when retry is safe. Missing-registry extends this
   seam in I9, not inferred from fetch failures.
4. Snapshot progress uses its existing request id (scoped to one runtime
   generation): fetch bytes and optional declared total; entries written/total
   counts payload files and directories actually changed, excluding root/cache;
   flush-cache and flush-payload carry native watermark persisted/total. Missing
   or content-encoded Content-Length is not a byte total. No whole-open percent,
   synthetic completion, or count on failed writes. Same-byte payload yields
   zero entry writes. Existing pending-request/peer guards discard late frames.
5. Explicit snapshot identity/template/runtime mismatches gain a discriminator;
   fetch/parse errors retain theirs. Conflicting payload targets retain existing
   typed conflict; same bytes are allowed, force preserves untargeted files.
   Snapshot native flush failure joins persistence outcomes.

## Alternatives and evidence

- Separate onLifecycle callback/replayed log: rejected; duplicates runtime.on
  and creates another subscription owner. Lift the existing hub before await.
- Resolve an unready sandbox: rejected; changes established readiness admission.
- Public error classes: rejected; reattachment and duplicate-package identity
  add machinery. A structural discriminator is sufficient.
- Fast occupied rejection/lease: rejected by I1 and ADR-0428; native two-opener
  tests retain both 5s host and 30s guard deadlines.
- Blanket nonempty rejection: rejected by goal Decisions and existing snapshot
  same-bytes/extra-file proofs (ADR-0417/0420).

Independent design review accepted the early Promise subscription and corrected
its initial blanket-conflict proposal against the actual accepted destination.
Real Chromium carriers: sdk-lifecycle.spec.ts, sdk-snapshot-progress.spec.ts.
