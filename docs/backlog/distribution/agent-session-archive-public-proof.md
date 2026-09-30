---
area: distribution
status: ready
title: Prove shared conversation archive through installed SDK and Workbench hosts
created: 2026-09-30
why: Source-level archive tests do not prove installed public consumers or source-project lifecycle.
epic: agent-session-archive
blocked_by: []
sources: [ADR-0482, ADR-0261]
code: [tests/integration/workbench-packed-consumer.mjs]
---

## Context

Core archive certified at d97031386; public session option and tools already
implemented. This unit supplies installed-host/end-to-end evidence and the required baseline
project-deletion repair. No new storage owner. I1/I3 reuse core browser fault proof.

## Challenge

challenge: 2026-09-30 — clear

Unchanged goal premise; public hosts are required by I4.

## Acceptance

1. Installed SDK and Workbench save automatically, reload, then a new project agent discovers and reads original messages/tool records without filename or transcript injection. Mandatory packed-consumer browser lane. → I2, I4
2. Source rename/delete and existing project export/import leave shared archive bytes unchanged. Public project lifecycle browser proof. → scenario, I2
3. Real model recalls an unpredictable phrase from an earlier project by archive_search/archive_read after reload on both public hosts. Live configured endpoint, captured trace. → scenario, I2, I4
4. Core originals/reset/compaction and acknowledged-write fault guarantees remain certified; core archive source unchanged. Required baseline Workbench project deletion repair stays in this unit. → I1, I3, scenario

## Fault matrix

| Axis × operation | Honest outcome | Carrier |
|---|---|---|
| observable-order × project deletion/stage cleanup | owner clears protected claims before guarded tree removal; ordinary mutation remains refused | real owner/VFS regression + existing claim-guard tests → scenario, ADR-0261 |
| sibling-drift × installed hosts | same shared archive owner and read tools on both | packed archive browser proof → I4 |
| torn-state × project lifecycle | archive unchanged through rename/export/import/delete | exact native file comparison → scenario, I2 |

## Out of scope

Goal exclusions unchanged. Playground UI integration is optional; its existing
public catalog/archive APIs are exercised only as source-project lifecycle.

## Decisions

re-cut: 2026-09-30 — required observed Workbench deletion defect joins installed-host proof; original archive obligations unchanged — trace: none

- 2026-09-30 — preparation: existing behavior at d97031386, core Final+GREEN; new acceptance carriers only (RDY-8), no product implementation.
- 2026-09-30 — user supplied ~/codex-proxy.mjs; launched PORT=10539, configured gpt-6-luna listed; same public provider API for live recall.
