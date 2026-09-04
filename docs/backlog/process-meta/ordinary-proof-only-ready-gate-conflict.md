---
area: process-meta
status: draft
title: ordinary proof-only pickup cannot satisfy the ready-contract drift gate
created: 2026-09-04
why: RDY-8 forbids Contract+RED lineage for ordinary units while check:contract-drift requires that lineage from a new ready unit whenever the aggregate PR contains production changes
code: [docs/process/rules/readiness.md, docs/process/artifacts/unit.md, tools/checks/contract-drift.mjs, tools/checks/contract-drift.test.ts]
---

## Context

Observed in the `no-coi-sandbox-tier` closing proof. A new `review: ordinary —
proof-only` unit was compiled `status: ready` beside a CI-only change. RDY-8
says it skips both checkpoints, so it correctly carried no `ready-verdict:`.

The goal PR already contained landed production slices. Aggregate
`check:contract-drift` therefore entered its production branch and rejected
the new item with:

```text
docs/backlog/distribution/no-coi-ci-closure-proof.md: ready flip without pickup Contract+RED verdict
```

The pre-commit `pnpm pr:check` passed because the gate reads committed HEAD,
not working-tree contract changes; the exact post-commit command failed. A
draft ordinary unit passes the gate but contradicts “never implement a draft”.
Adding a fake Contract+RED line contradicts RDY-8. Changing the referee in the
same implementation PR violates PR-4.

No user-observable product fork exists. The process needs one consistent
ordinary pickup state and a gate that validates it on the content actually
being delivered.

## Challenge

challenge: 2026-09-04 — 2 problems
- Impact is one unsized incident.
- Cheaper route — keep closure proof in the originating unit or separate
  proof-only PR — is not ruled out.
