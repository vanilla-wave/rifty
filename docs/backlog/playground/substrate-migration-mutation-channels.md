---
area: playground
status: draft
title: Mutation channels adopt the correlation substrate
created: 2026-07-22
epic: extraction-ready-page-realm
blocked_by: [playground/page-owner-correlation-substrate]
sources: [ADR-0305]
code: [apps/playground/src/glue/git-owner-port.ts, apps/playground/src/glue/workspace-archive-port.ts, apps/playground/src/workbench/internal/playground-session-tools-transport.ts]
why: git, archive-import, and session-tool mutations still carry per-port engines whose deadlines can assert a failure the owner later contradicts
---

## Context

Migrate remaining mutation channels onto the substrate (ADR-0305 mutation class: settle on owner terminal or owner death; a channel lacking a death signal gains one at adoption — the cost named in the ADR). Delete each port's engine on migration; green paths pinned by the port's existing contract tests unchanged. Coordinate with `workbench-fault-honesty` terminal-certainty children (PR #158): after this, they are per-channel RED cases, not scaffolds. Refinement enumerates the exact mutation surface per port (reads in the same port stay in the read class).
