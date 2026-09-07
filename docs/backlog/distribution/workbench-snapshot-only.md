---
area: distribution
status: draft
title: Run a snapshot-backed Workbench without a browser registry
created: 2026-09-07
why: The public options require a registry URL and first-snapshot rejection schedules a real install.
user_story: As the Tracker plugin-sandbox embedder, I want to run a snapshot-backed workbench without a browser registry, but today the public options require a registry URL and first-snapshot rejection schedules a real install.
epic: self-hosted-snapshot-workbench
blocked_by: [distribution/dep-snapshot-producer, distribution/workbench-static-assets]
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md]
code: [packages/workbench/src/workbench/internal/workbench-options.ts, packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/workers/owner-package-state.ts]
---

## Context

An internal snapshot-only ensure exists, but public first-materialization catches
its unavailable result and constructs deferred install. Public admission must
allow no registry URL, restore the published producer's compatible snapshot,
and start the real installed project with zero registry/Eddy requests. Missing,
corrupt, incompatible or over-limit input fails before guest startup with its
reason. A later npm/package call cannot escape this mode into a hidden network
install; replay using available exact bytes may work, absent bytes fail loudly.

Registry-enabled mode keeps its current behavior. This is not general offline
network isolation: snapshot/static assets are fetched, and guest application
network behavior is unchanged. Reuse the existing acquisition authority; API
shape is an ADR choice. Cross-boundary proof denies registry egress while
restoring the producer tar.gz and running a real Vite build/dev command.

Scope and user decisions: goal I3. Baseline/dedup and executed evidence:
docs/backlog/distribution/reference/embedder-gaps-evidence.md.

## Decisions

- 2026-09-07 — finding draft; observable scope is settled by goal I3; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
