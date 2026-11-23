---
area: distribution
status: draft
title: Compaction summaries list files touched by rifty's own file tools
created: 2026-11-23
why: the ported CLI 1.6.0 file-operation extraction keys on read/write/edit; rifty's read_file/write_file/edit_file/apply_patch never fill <read-files>/<modified-files>
user_story: As an agent user in a long session, I want the compaction summary to keep the list of files the agent read and changed, but today rifty's file tools are not recognized, so the lists stay empty
epic:
blocked_by: []
sources: [ADR-0569, ADR-0473]
code: [packages/agent/src/pi-cli/compaction.ts]
---

## Context

PR #423 review: `extractFileOpsFromMessage` (ported verbatim from pi CLI 1.6.0) matches
the CLI tool names only; ADR-0473 Consequences keep native names unrelabelled. Not a
regression (0.85.1 behaved the same). The `file-ops` parity scenario exercises the CLI
names, a path rifty's built-in tools do not take. Options: map rifty tool names (and
`apply_patch` paths) in the adapter, keeping the port verbatim; or keep CLI parity.
Trigger: a long-session eval or user report showing lost file context after compaction.

## Challenge

challenge: 2026-11-23 — not run (draft)
