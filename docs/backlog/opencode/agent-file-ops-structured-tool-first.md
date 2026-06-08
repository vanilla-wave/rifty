---
area: opencode
status: parked
title: Agent file ops — structured-tool-first, minimal bash fallback
created: 2026-06-08
why: opencode agents have structured file tools + one bash tool; models still shell out to rg/ls/find even when structured tools exist — lean structured-first to curb shell exploration
sources: [Q-2026-06-06-406, adr/opencode/0092-git-agent-facing-contract-m12-read-ops.md]
---

## Context

M12 facade lean: the dominant channel is pure-JS facade tools over the VFS (read/grep/glob/list/edit/write, no pipe dependency); keep a `list` tool (opencode #6506) and tune the facade prompt to curb shell exploration.

## Options or Next

The literal-bash fallback is lower priority, gated on the M12 pipes+glob+stdin chain (ADR-0089/0091). Pre-implementation.

## Reversibility

REVERSIBLE — facade-design lean, no committed contract yet.
