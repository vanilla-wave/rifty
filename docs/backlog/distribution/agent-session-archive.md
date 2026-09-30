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

Archive capability: ❌. Both current agent adapters expose project-scoped files;
neither supplies automatic shared history. The public initialMessages option
restores a host-provided context; it does not store or discover earlier sessions.
Source evidence and exact user decisions are in the linked refine evidence.

## Question

What minimal public storage/access boundary lets the real SDK and Workbench
hosts share durable conversation files independently of project lifetime?
PICKUP resolves the goal map's agent-owned questions, records the public API ADR
and mechanism inventory, and runs discriminating REDs before implementation.
No archive path, file format, mount, index or new state owner is selected here.

The first proof saves one conversation and reads it after reopen. Extend the
same owner to all sessions, compaction/reset, cross-project recall, source-project
deletion and both installed consumers. Compile I1–I4 acceptance and production
fault rows together; never use a fake filesystem or direct transcript injection
to prove discovery. Goal readiness does not make this item ready (`RDY-1`).
