---
area: runtime-js
status: draft
title: child_process.fork + IPC hangs >45 s on the COI kernel-worker path (same-realm completes)
created: 2026-08-26
why: hang is not a loud gap — a fork'd child exchanging IPC messages never settles on the product path while the degraded same-realm path finishes exit=0 with the message delivered; inverts the "COI = capable tier" assumption
user_story: As a dev whose tool `fork`s a worker and exchanges IPC messages (build orchestrators, test runners), I want the exchange to complete on the product COI path, but today it hangs past 45 s and needs a manual interrupt — the no-COI same-realm fallback completes the same guest source with exit=0 and the IPC payload delivered.
sources: [docs/backlog/runtime-js/reference/no-coi-degradation-probes.md, ADR-0150]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/ipc/fs-handlers.ts]
---

## Context

Probe (reference table): same guest source — `fork` a module, child sends
`{"hi":1}` over IPC, parent awaits message + exit. Same-realm: exit=0,
`ipc={"hi":1}`. Product COI (kernel-spawned worker child, fork:true through
`spawnWorkerChild`): no settle in >45 s, interrupted manually. Root cause not
diagnosed in the spike — candidates (unverified): IPC channel wiring over the
worker boundary, fork control frames (ADR-0150 P6b fork-control), exit/close
ordering. Needs root-cause before any contract (`rifty-fix` shape at pickup:
RED e2e first).

Contradicting evidence (independent challenge 2026-08-28): main CI has a GREEN
fork+IPC e2e — `tests/browser-unit/recursive-node-sqlite.spec.ts:227` ("real
fork Worker crosses owner FS, launch context, recursive IPC, and disconnect
control", blocking browser-unit-chromium job) asserts exit 0 with messages
delivered through the sealed workbench terminal path. The spike probe ran on a
modified prototype branch; the hang may be a spike-branch artifact, not a
product defect. First pickup step: run the standing repro on main — a green run
dissolves this item.

## Options or Next

- Minimal RED: e2e fork+IPC round-trip on the COI path with a bounded timeout.
- Diagnose against ADR-0150 fork-control frames; fix or loud-throw — never a
  hang.

## Reversibility

REVERSIBLE — correctness repair behind existing `fork` surface.
