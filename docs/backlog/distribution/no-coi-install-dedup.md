---
area: distribution
status: ready
title: Skip only proven durable installer writes and directories
created: 2026-09-08
why: Repeated no-COI installs rewrite unchanged native OPFS package files.
epic: no-coi-persisted-warm-open
code: [packages/workbench/src/workers/no-coi-toolchain-install.ts, packages/vfs/src/opfs-sync.ts]
---

## Context

Install-only SyncMirrorVfs adapter; generic writes retain Node side effects.
The OPFS owner checks existing scheduler/ledger before skipping. Compare fresh
native bytes AND current mirror bytes with nonempty incoming bytes; mutable
cache references cannot prove durable equality. Fresh directory lookup proves
existence only alongside clean ancestor persistence. Unknown/dirty paths use
the existing unconditional write/mkdir healing path. No extra coordinator.

## Acceptance

1. Cached explicit nanoid install makes no repeated index.js writes or native nanoid create-directory calls; changed package bytes repair. → I4
2. Empty, unreadable, dirty and pending paths never qualify solely from mirror existence/equality; native failures remain visible and later explicit installs heal. → I3 + I4
3. Generic writeFile and recursive mkdir retain ordinary persistence behavior. → I4

## Fault matrix

| Axis × operation | Honest outcome | Carrier |
| --- | --- | --- |
| poisoned-cache × same-length modification | Fresh durable bytes + mirror compare; otherwise repair | tests/no-coi/no-coi-install-dedup.spec.ts → I4 |
| quota-perm-fail × reinstall | Dirty paths write/heal or reject, never skip | tests/no-coi/no-coi-install-dedup.spec.ts → I3 + I4 |

## Out of scope

No generic write suppression, foreign-writer coherence or crash transaction.

## Challenge

challenge: 2026-09-08 — clear; reuse goal I4 premise. Fresh reads cost lookup,
but establish equality without a new byte ledger or mutable-cache assumption.

## Decisions

ready-verdict: 2026-09-08 — Contract+RED @ f822d4e2281bd66c28aeafbf63056309e23452a9 — docs/backlog/distribution/reference/issue319-contract-red.json

- 2026-09-08 — RED native nanoid repeat: index.js writable calls 4, nanoid mkdir(create) 5; repair succeeds. Command in tests/no-coi/no-coi-install-dedup.spec.ts via pnpm test:no-coi, ports 5511–5513.
