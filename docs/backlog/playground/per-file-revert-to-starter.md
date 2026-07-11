---
area: playground
status: draft
title: Per-file revert-to-Starter (needs source provenance)
created: 2026-06-21
why: ADR-0165 reset is WHOLE-workspace re-seed only; a user who wants to undo edits to ONE file must blow away the entire scratch — per-file revert needs a baseline diff that doesn't exist yet
user_story: As a playground user who edited several files from a Starter and regret changing one, I want to revert just that file to the Starter version, but today the only restore is whole-workspace Reset (ADR-0165), which discards every edit.
sources: [ADR-0165, ADR-0078]
code: [apps/playground/src/templates, packages/workbench/src/glue/workspace-archive-port.ts, apps/playground/src/App.tsx]
---

## Context

ADR-0165 fixed reset as a one-shot whole-workspace re-seed from the Starter bundle (baseline = the registry definition, re-derived by `starter` id — no per-project stored baseline). That covers "reset everything" but not per-file revert, because per-file revert needs to know, per file, the Starter's original bytes AND whether the live file is a user edit vs untouched. The bundle gives the original bytes (Starter files[]), but there's no live-vs-baseline diff to drive a "modified" badge or a single-file restore.

This is the remaining open half of `template-edit-provenance-reset` (whole-workspace reset folded into ADR-0165; provenance/per-file revert stays here).

## Options or Next

- Derive per-file baseline on demand from the Starter bundle (original bytes are re-derivable; no stored baseline needed for a SOURCE file that exists in the bundle).
- Diff live tree vs bundle → "modified / added / deleted" provenance → explorer badge + per-file "Revert to Starter".
- Fork: files NOT in the bundle (user-created) have no baseline — revert = delete, surface that distinctly.
- Genuine design choice if a persisted baseline is wanted for non-source artifacts → its own ADR (touches the single-store owner topology, as flagged in `template-edit-provenance-reset`).

## Reversibility

REVERSIBLE — scope as a backlog item. A persisted-baseline variant would be a design choice → ADR when taken. No public API change for the re-derived-from-bundle path.
