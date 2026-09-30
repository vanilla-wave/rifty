---
area: distribution
status: draft
title: Persist agent conversations as a shared filesystem archive on SDK and Workbench hosts
created: 2026-09-30
why: Host-owned initialMessages cannot automatically preserve and discover all conversations across projects.
epic: agent-session-archive
sources: [ADR-0424, ADR-0466, ADR-0474, docs/backlog/distribution/reference/agent-session-archive-refine.md]
code: [packages/agent/src/session.ts, packages/agent/src/workbench-host.ts, packages/agent/src/sandbox-host.ts, packages/workbench/src/workbench/project-file-boundary.ts]
---

## Context

Ready goal I1–I4; original scope in goal and refine evidence. ADR-0482 selects
one OPFS archive independent of project ownership. Implementation awaits RED review.

## Challenge

challenge: 2026-09-30 — clear

Reuse goal premise and final scope check; unchanged accepted outcome.

## Acceptance

1. Archive-enabled send automatically retains original messages, tool calls/results, images and source identity; reset/new session/compaction never erase originals. Browser archive suite + native session receipts. → I1
2. New project agent discovers and paginates original conversations on request without supplied filename or transcript. Real MemoryVfs host and OPFS browser suite. → I2
3. Durable receipts follow native write close; reload/interruption retains last acknowledged bytes and identifies incomplete state. Storage errors are visible, corrupt records never reported complete. Browser fault suite. → I3

## Fault matrix

| Axis × operation | Honest outcome | Carrier |
|---|---|---|
| torn-state × close/reload | last acknowledged snapshot intact; interrupted run incomplete | native write interruption browser test → I3 |
| quota-perm-fail × snapshot write | archive error event and error run status; no durable success receipt | native permission/quota browser tests → I3 |
| corrupt-input × discovery/read | explicit corrupt filename; never complete | corrupt archive browser test → I3 |
| concurrent-same-key × cross-tab save | distinct session IDs/files; no lost acknowledged messages | two-tab browser test → I1, I3 |
| lossy-aggregate × compact/read | original content outside context/output window readable by pagination | reset/compaction/long-history browser tests → I1, I2 |

## Out of scope

Goal map exclusions unchanged; no Playground integration, cloud synchronization,
historical replay, or recovery of never-acknowledged bytes. Archive-disabled
sessions keep the existing host-owned history contract.

## Decisions

- 2026-09-30 — ADR-0482: shared OpfsVfs, UUID-owned atomic snapshots and bounded read tools; reference/agent-session-archive-evidence.md.
