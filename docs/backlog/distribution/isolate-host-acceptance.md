---
area: distribution
status: draft
title: Isolate host acceptance carrier — the runCode scenario as executable tests over isolated-vm and a live node oracle
created: 2026-11-18
why: First unit of goal isolate-host-run-code; the scenario must be executable and RED before the host exists.
epic: isolate-host-run-code
blocked_by: []
sources: [docs/backlog/epics/isolate-host-run-code/goal.md]
code: []
---

## Context

The goal's `## User scenario` steps 1–5 as tests: corpus parity against a
live `node -e` child (I1), fresh-instance (I2), canaries (I3), each limit
(I4), egress (I5), packed install into a clean project (I6). Real
isolated-vm, real built guest runtime, real child processes; no mocks.

## Challenge

challenge: 2026-11-18 — inherits the goal premise check (`goal.md` §Challenge)
