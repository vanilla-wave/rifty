# ADR 0306: Glue carved along the Workbench extraction seam

Status: Accepted
Date: 2026-07

> TL;DR: `apps/playground/src/glue` (101 direct prod modules, no owner) is carved into subdirs whose boundary is the future `@riftydev/workbench` package line — extractable vs app-local — with depcruise rules pinning the seam.

## Context

`glue/` is the unguarded middle where page-realm complexity pooled (dir-owner retro). `distribution/workbench-controllers` names it as source material for the `@riftydev/workbench` extraction, but no structure marks which modules travel with the package and which stay Playground-local; extraction step 6 would start with a 101-file sort. Alternative considered — domain-only carve (channels/project/tooling): cheaper and uncontroversial, but leaves the extraction seam undecided until the extraction itself, and the carve would likely be redone.

## Decision

Subdirs mirror the extraction boundary: modules that move into `@riftydev/workbench` vs modules that stay app-local, domain-grouped inside each side. Every subdir carries its owner README (`check:dir-owner` discipline); depcruise rules pin the seam the same way ADR-0282 pins sealed Workbench entrypoints (app-local must not be imported by extractable). Disputed files are resolved toward app-local — moving into the package later is additive, the reverse is a break.

## Consequences

- `workbench-controllers` extraction steps start from an enforced boundary instead of a sort.
- Seam placement decided per file now; some calls will be corrected at extraction — accepted, the rules make the correction visible.
- Import-path churn across the page realm (mechanical, behavior-preserving; CHANGELOG only).
