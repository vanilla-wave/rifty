---
area: distribution
status: draft
title: Configure no-COI worker storage and effective startup budget
created: 2026-09-10
why: SDK embedders must currently override storage globals and patch the fixed handshake deadline
epic: no-coi-self-hosted-project
sources: [https://github.com/vanilla-wave/rifty/issues/328, https://github.com/vanilla-wave/rifty/issues/329, docs/backlog/distribution/reference/no-coi-project-open-refine.md]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/worker-entry.ts, packages/workbench/src/workers/owner-storage.ts, packages/vfs/src/boot.ts]
---

## Context

Goal I1/I2. SDK options currently expose no namespace/persistence policy or
startup budget; runtime host uses 10,000ms. Existing Workbench storage selection,
VFS native-root mounting and timer validation supply reusable behavior.

## Reference contract

Existing SDK/Worker boot, ADR-0383 native Worker.name carrier; literal native
OPFS roots and required/preferred policy from ADR-0402/0411. Native browser
behavior, not a Node semantic proxy. API decisions: ADR-0419.

## Acceptance

1. Public `storage: { namespace?, persistence? }` reaches native worker preload;
   default preferred/origin root; namespace A/B and omitted root retain their
   own bytes across restart/recreation, leaving unrelated files untouched.
   Carrier: `tests/no-coi/no-coi-configured-startup.spec.ts`. → I1
2. Required OPFS rejects/tears down; preferred reports `vfs.reason`; unreadable
   acquired preload always rejects. Carriers: configured-startup and existing
   `no-coi-preload-failure.spec.ts`. → I1
3. Public `startupTimeoutMs` defaults to 10000; finite positive integer through
   2147483647, covering Worker construction/import/VFS preload/runtime handshake,
   initial and restart. Native 11s preload succeeds under 30s. → I2
4. Invalid namespace, policy and budget reject before Worker/SW/storage effects.
   Carrier: `sandbox-startup.contract.test.ts`. → I1, I2
5. Deadline/close/dispose rejects pending startup/eval/fs, terminates Worker;
   late readiness cannot revive it. Carriers: `host-startup.fault.test.ts` and
   configured-startup native timeout/close cases. → I2

## Fault matrix

- corrupt-input × boot config | TypeError/RangeError, no effects | SDK invalid-input rows → I1, I2
- quota-perm-fail × native acquisition | required rejection/teardown, preferred visible fallback | configured-startup → I1
- corrupt-input × acquired preload | reject, preserve disk; never memory fallback | existing no-coi-preload-failure → I1
- unbounded-read × slow preload | below budget succeeds, deadline terminates/settles | native delayed/timeout + host fake clock → I2
- torn-state × close/dispose during boot | pending calls reject, no late revival | native close + host-startup → I2
- sibling-drift × restart | same captured namespace/budget | native namespace + 11s restart → I1, I2

## Challenge

challenge: 2026-09-10 — clear

Reuses unchanged goal premise and final written-result review. No new
observable scope; extend existing bootstrap carrier, backend and timer owners.

## Out of scope

Snapshot/apply/run deadlines and namespace migration: goal map exclusions.
No new lock, ledger or coordinator; native worker total-inflight-loss model.

## Decisions

- 2026-09-10 — ADR-0419 selects configuration metadata and the existing handshake timer; no extra timer owner.
- 2026-09-10 — RED artifacts: docs/backlog/distribution/reference/no-coi-worker-startup-evidence.md.
