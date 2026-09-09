---
area: distribution
status: ready
title: Configure effective Workbench boot and project-operation wait budgets
created: 2026-09-07
why: Hidden owner-ready, storage-proof, file-commit and tool deadlines can defeat a host-selected budget.
user_story: As the Tracker plugin-sandbox embedder, I want to configure effective workbench boot and project-operation wait budgets, but today hidden owner-ready, storage-proof, file-commit and tool deadlines can defeat a host-selected budget.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [ADR-0410, ADR-0360, ADR-0263, ADR-0358, docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md]
code: [packages/workbench/src/workbench/workbench-owner-port.ts, packages/workbench/src/workers/workbench-owner-storage.ts, packages/workbench/src/workbench/workbench-browser-owner.ts, packages/workbench/src/workbench/internal/playground-session-tools-transport.ts]
---

## Context

Goal I7/scenario7 requires effective public startup, file and Playground
request budgets. Configure existing timer owners; retain admission, applied/
unknown outcomes, progress-only silence and native persistence fencing.
Scope authority is the accepted goal plus recorded embedder decisions; no
claim of reviewing an unavailable private Tracker source or raw transcript.

## Reference contract

ADR-0410 selects bounded native delays and propagation through existing owners.
Chromium148/Node24.16 timer probes show overflow can fire immediately; only
finite 0 < value <= 2147483647 is accepted, then rounded upward. This host
policy leaves guest Node timers unchanged. Existing ADR-0360/0358 and actual
owner/coordinator baseline govern silence, settlement and late IO completion.

## Acceptance

1. Both public entrypoints expose deployment.ownerStartupTimeoutMs(B), projectFileCommitTimeoutMs(F) and playgroundRequestTimeoutMs(T), alongside existing ownerOperationSilenceTimeoutMs(S) and previewProbeTimeoutMs(P). One normalizer validates all five original values in the bounded native domain, rounds positive fractions upward, captures immutable values and rejects invalid input before deployment effects. Omission remains distinct. → I7, ADR-0410, ADR-0263
2. B controls the existing owner-ready budget and owner storage-proof steps, including mount/preload/catalog readiness. Default30s remains. Readiness starts after lease/SW control admission; physical-exit observation keeps its independent30s budget. Slow close/read/cleanup within raised B must still produce actual OPFS/durable proof. → I7, scenario7, ADR-0410
3. F controls existing post-applied reflection/durability phase observation and the shorter owner-VFS durability ACK/recovery barrier. Omission keeps60s phases/35s ACK. No new pre-ACK timer; slow admitted request or ordered state+ACK stays pending. Timeout/death retains public applied/unknown evidence, exact bytes and one-send settlement; later completion cannot rewrite rejection. → I7, scenario7, ADR-0410
4. T controls non-TS Playground session-tool SCM/archive/durability/close requests after the document-save admission barrier. Default60s remains. Raising T survives the old60s bound; lowering it rejects observation while the owner stays usable. Delayed admitted mutation may complete; no rollback/not-applied claim, retry or late-result resurrection. → I7, scenario7, ADR-0410
5. Catalog operations retain the existing uniform progress-only S policy (default60s), independently of T. Real durability progress rearms S; unrelated traffic does not. Fatal owner death and already-applied catalog bytes preserve the baseline semantics. → I7, ADR-0360
6. One captured shared OPFS report bound derives from applicable explicit B/F/T/S values, using their maximum; P is excluded. All omitted keeps30s. Actual boot decoder accepts only normalized integer bounds, and existing storage installation forwards this captured value to the paired instance's current drain scheduler. No global mutable policy. → I7, scenario7, ADR-0410
7. Native active-IO timeout reports failure without freeing its lane/path fence, resending a mutation or claiming rollback. Late native success heals the existing ledger and exact bytes; same-path and capacity dependents wait for physical completion. Explicit short/long and omitted30s settings use this same existing owner. → I7, ADR-0358
8. Mandatory copied-asset /sandbox/ packed host configures public budgets and runs actual startup, catalog, file/durability, SCM/archive and Vite build/dev/HMR. Composed prior accepted snapshot, namespace, saved-state/apply and retained-Scratch proofs remain GREEN with zero registry/Eddy egress; docs state all defaults/start/reset/range and settlement semantics. → I1, I2, I3, I4, I5, I6, I7, I8, scenario7

## Parity cases

1. Executed Chromium148/Node24.16 boundary-value probes discriminate native timer overflow; upward fractions/MAX acceptance and original-value overflow rejection are host policy, not a guest Node change. → I7, ADR-0410
2. Real owner/VFS/Git/OPFS graphs preserve baseline mutation and persistence outcomes; only external clock/native handle delivery/physical IPC boundaries are delayed. Real Vite/npm packed acceptance remains the ecosystem oracle. → I7, ADR-0358, ADR-0360

## Fault matrix

| axis × operation | honest outcome / carrier | trace |
|---|---|---|
| corrupt-input × public budget/owner boot | type/range/overflow rejected before effects; normalized immutable integer wire values | → I7, ADR-0410, ADR-0263 |
| sibling-drift × startup/file/tool/catalog/native IO | raised B/F/T/S reaches shorter existing siblings; max applicable explicit values, P excluded, omissions preserved | → I7, scenario7 |
| observable-order × file admission/tool save barrier | no new timeout before applied file ACK or tool send; FIFO state precedes ACK; one mutation | → I7, ADR-0410 |
| provenance-lie × timeout/death/storage proof | applied/unknown preserved; actual persisted read required for durable claim; late result cannot rewrite settled observation | → I7, ADR-0358 |
| concurrent-same-key × timed-out native write | native completion retains path fence/lane; late heal releases dependents, no resend | → I7, ADR-0358 |
| unbounded-read × slow native report/capacity | report settles at selected bound but16 native lanes remain occupied; capacity waiter runs only after actual close | → I7, ADR-0358 |
| torn-state × admitted mutation/owner death | real applied bytes survive timeout; owner death rejects pending operations with existing evidence | → I7, ADR-0360 |
| false-progress × catalog silence | only actual durability progress rearms uniform S; ordinary traffic cannot prolong owner lifetime | → I7, ADR-0360 |

## Out of scope

No global openWorkbench wall-clock or project asset-acquisition budget, machine
speed/maximum project size promise, guest execution/TS/PTY timer change, snapshot
byte-cap change, new retry/timeout coordinator or segmented multi-week timer.
Real owner publishes file state before ACK over one ordered port; do not invent
post-ACK reflection delay by reordering those frames. Generic coordinator
reflection behavior retains its existing tests.

## Decisions

- 2026-09-09 — pickup: ADR-0410 configures existing owners, partially supersedes ADR-0360 numeric/page-only and fixed file-budget clauses; native range decision and source/native REDs recorded in reference/workbench-operation-budgets-evidence.md.
- 2026-09-07 — finding draft; observable scope is settled by goal I7; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit goal production fault tier; existing owners, no new coordinator.

## Challenge

challenge: 2026-09-07 — clear
