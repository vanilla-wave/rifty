# PR316 I7 — independent numeric-domain decision

2026-09-09; inspected HEAD `79f5d7e9bfd56f89a216637474eb8775f1210af2`.
DEC-2 decision review, depth 1/read-only tracked tree. No implementation,
test-suite, ADR or build edits. Authority: accepted goal scenario 7/I7,
ADR-0360, ADR-0263, AGENTS Fidelity/Simplicity. Private transcript unavailable;
no scope inferred beyond accepted goal and recorded decisions.

## Decision

Accept the minimal bounded native-delay domain for public deployment budgets:
**number, finite, `0 < value <= 2_147_483_647`; normalize with `Math.ceil`**.
Reject other values with a field-specific TypeError before browser effects.
Validate the original value before rounding. Examples: `Number.MIN_VALUE`
and `0.1` → `1`; `1.1` → `2`; `2_147_483_646.75` → maximum; maximum stays
maximum; maximum + `0.25` rejects. Accepted fractions never deliberately
reduce the requested budget. This is Workbench configuration policy, not a
change to guest Node timer semantics or an exact wall-clock timing promise.

Use the existing public normalization authority for new B/F/T and existing S
**and P**:

- B `ownerStartupTimeoutMs`.
- F `projectFileCommitTimeoutMs`.
- T `playgroundRequestTimeoutMs`.
- S `ownerOperationSilenceTimeoutMs`.
- P `previewProbeTimeoutMs` — intentional same-boundary defect repair.

Normalize before deriving any maximum or forwarding to a timer. Carried
normalized values are integers `1..maximum`; inspect worker inputs against
that domain before timer construction. No alternate timer owner, long-delay
scheduler, native monkeypatch, silent clamp, retry or new public helper.

Preserve omitted values and existing defaults, including the inner 35s file
ACK and 30s OPFS report defaults. P stays independent of B/F/T/S and does not
enter their derived OPFS maximum. Only explicit applicable B/F/T/S overrides
may extend that shared report bound. No mutation-settlement, silence reset,
timeout start/rearm, preview readiness, guest timer, TS or asset-stall changes.

## Independent evidence

Read both supplied pickup reports, original native probe source/JSON/log and
exact current validation helper source; independently reran an expanded probe:

```text
node /tmp/rifty-316-i7-budget-range-independent-probe.mjs \
  > /tmp/rifty-316-i7-budget-range-independent-probe.log 2>&1
PASS — Node v24.16.0; Chromium 148.0.7778.96; 100ms observation; all timers cleared.
```

Script and JSON share that stem. Initial sandbox browser launch failed at
MachPort; same probe passed with approved local browser execution.

| Requested ms | Node | Chromium |
|---:|---|---|
| 2,147,483,646.75 | pending | pending |
| 2,147,483,647 | pending | pending |
| 2,147,483,647.25 | fired ~1.84ms | pending |
| 2,147,483,648 | fired ~1.85ms | fired ~0.10ms |
| 4,294,967,346 | fired ~1.85ms | fired ~52.4ms |
| Number.MAX_VALUE | fired ~1.86ms | fired ~0.10ms |

Node warnings explicitly replace overflow with 1ms. The source-extracted,
unchanged `positiveFinite` helper accepts these finite inputs at both P/S
paths; SHA256 `9b98b9be4e18c80c756a29f640b455ebb8e12c8a83d65f8bd6f15e9fa9e481c8`.
That extraction proves the helper only, not full public admission/boot.

Reach is explicit in current code: public normalization
`workbench/internal/workbench-options.ts:84-97`; S reaches native
`workbench-browser-owner.ts:308`; P reaches native
`service-worker-control.ts:134` via `open-workbench.ts:193`, and
`preview-readiness.ts:216` via `workbench-browser-owner.ts:861`.
P is therefore the same observed validator defect, not speculative hardening.
The earlier edge report's recommendation to leave P unbounded is rejected.

## Alternatives

| Candidate | Evidence / verdict |
|---|---|
| Explicit maximum + upward integer normalization | Keep. Native representable domain, one stateless validation boundary; honest rejection instead of false budget. Accepted goal has no multi-week or arbitrary-finite duration promise. |
| Preserve arbitrary positive finite values with a segmented long timer | Reject, REV-7. Adds clock/rearm/cancellation/remaining-duration state and floating-point edge cases; no accepted scenario requires this machinery. Existing native clocks alone cannot provide it. |
| Preserve existing positive-finite validation/native normalization | Reject. Executed overflow makes a larger admitted budget expire almost immediately; directly undermines I7. Chromium and Node even differ above the boundary. |
| Silently saturate at maximum | Reject. Admits a requested duration it does not deliver; hides unsupported range. |
| Require positive integers only | Reject. Unnecessary fractional compatibility break; ceil supplies representable monotone values with no new mechanism. |

## Exact ADR disposition

New ADR partially supersedes **ADR-0360 §Decision / Budget**:

1. Replace `validated as a positive finite number` with the bounded range and
   upward normalization above. Keep `60_000`, option name and silence meaning.
2. If the planned owner-wide OPFS report bound derives from explicit S,
   explicitly supersede `Page-side policy only: it never enters the owner
   boot config, so the owner protocol is unchanged.` S's operation timer
   remains page-owned, but its derived inner bound now crosses owner boot.

For the broader I7 ADR, name the extension of **§Decision / Uniform policy**
phrase `PROJECT_VFS_COMMIT_TIMEOUT_MS ... untouched`: F now controls that
separate observation budget. Retain the kernel/child-timeouts portion and the
single uniform S budget for all owner operations; do not characterize F as a
per-operation-kind S override. All progress-only reset, fatality, recovery and
admitted-mutation settlement clauses remain active.

ADR-0263 was read in full: no positive-finite-only or unrestricted numeric
promise for P. Cite its deployment/preview and pre-effects-validation seam;
range policy alone needs **no partial supersession of ADR-0263**. Keep its
existing unrelated corrections. Draft budget item's positive-finite wording
must match the successor decision at pickup; it is not accepted user scope.

## Remaining obligations / limits

Producer must record the public-domain correction and intentional P repair in
ADR/changelog, then carry public Contract+RED/GREEN: boundary values, upward
fractions, field-specific rejection before effects, omission/defaults and
actual B/F/T/S propagation. Verify P reaches its existing owners unchanged
except normalized range; preserve mutation settlement and silence regressions.
The native probe is supporting numeric evidence, not this product proof or
packed-consumer acceptance. No full timer/API sweep required; no new user
decision or additional capability obligation found.
