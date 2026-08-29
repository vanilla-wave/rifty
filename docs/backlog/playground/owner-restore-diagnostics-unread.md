---
area: playground
status: draft
title: Owner restore/promotion diagnostics have no read surface on the active boot path
created: 2026-08-30
why: Owner package log sink is `process.stdout.write` with no prod reader — the restore-success line and reportPromotion detailed prose never surface anywhere (the bare promotion-refused reason does reach console.warn via the authority observe hook); the ADR-0278:183 printed-reason/visible-install transcript was not observable in a 404 injection.
user_story: As a developer whose OPFS persistence is degrading, I want restore/promotion diagnostics findable on some surface, but today only a bare promotion-refused reason reaches devtools; the restore line and the explanatory prose are written to an owner stdout nobody consumes.
sources: [Contract+RED attempt-1 review of playground/cold-restore-progress-visibility (Bugs axis finding, 2026-08-30), spike 2026-08-29/30 (zero restore/promotion lines in any console across all runs), ADR-0278:183 (rejected snapshot probe prints its reason on the install terminal — the only declared surface), PR #167 (merge 7828b058) rewiring]
code: [packages/workbench/src/workers/workbench-owner-runtime.ts, packages/workbench/src/workers/owner-package-state.ts, packages/workbench/src/glue/project-deps.ts]
---

## Context

`workbench-owner-runtime.ts:343` wires owner package `log:` to
`globalThis.process.stdout.write` — no prod reader exists; spikes captured
zero `[real-vite/worker]` lines in any console (page or workers) across cold
boot, evicted reload, and slow-restore runs.

Scope of the loss (challenge-corrected): the authority observe hook DOES
surface a bare `promotion-refused` reason on every path — owner-package-state
~331-337 turns it into `console.warn('[shell-owner/worker] package stamp
promotion refused…: <reason>')`, including
`stamp-promotion-revocation-not-durable`. What never surfaces: the restore
success line and `reportPromotion`'s explanatory prose (project-deps.ts:291 —
persist-failure samples, «reload is unsafe until browser storage recovers»)
— the active `activateAndEnsure` first-materialization branch
(workbench-owner-runtime.ts:385) never reaches that legacy `restore()` code,
and the legacy sink itself is unread.

ADR-0278:183 declares one diagnostic surface: a rejected `kind: 'snapshot'`
probe prints its recorded reason on the install terminal before the visible
real install. Promotion/damage diagnostics have no declared surface.

Measured 2026-08-30 (seam `rifty-e2e-snapshot-fault=status:404`, vite8 cold
deep-link): the gz 404s once, a real install runs (npm-client peer/optional
resolver lines in devtools console) and the dev line reaches LIVE — but the
terminal viewport shows neither the recorded reason nor an `npm install`
transcript (scrollback unverified). Possible ADR-0278:183 deviation — verify
scrollback before treating as a defect.

Unresolved user-observable fork (→ manual `rifty-refine`): which surface —
devtools console, terminal, health UI — and which severities. Until then this
stays draft. Sibling item `[[cold-restore-progress-visibility]]` deliberately
excludes diagnostics (adjudicated scope, attempt-1 Goal-drift blocker).
Broader umbrella: `[[structured-execution-diagnostics]]` (owner→page
structured diagnostics contract, blocked by `[[diagnostics-hub]]`) — this item
is a concrete evidence slice of that same gap; resolve together at refine,
don't derive two competing contracts.

## Challenge

challenge: 2026-08-30 — 2 problems
1. "Invisible everywhere" overstates the WARNING/CRITICAL severity claim: `package-acquisition-authority.ts` `#completePromotion` (line ~1543-1553) unconditionally reports a `'promotion-refused'` event to the authority's shared `observe` hook whenever a stamp promotion isn't trusted — this fires from `#ensure`/`#install`, which run on *both* the legacy `restore()` path and the active `activateAndEnsure`/`prepare-first-materialization` path (`package-acquisition-authority.ts:1030-1070`, `:1304-1312`, `:1495-1502`), independent of whether the caller wired `onPromotion` (confirmed `owner-package-state.ts` never references `onPromotion` at all). `owner-package-state.ts:331-337` turns that event into `console.warn('[shell-owner/worker] package stamp promotion refused for ${projectId}: ${reason}')`, where `reason` includes `stamp-promotion-revocation-not-durable` for the exact CRITICAL case the draft cites as its headline example. So the CRITICAL/WARNING *signal* already reaches devtools console on every path — only `reportPromotion`'s detailed prose (project-deps.ts:291) and the restore-success line are legacy-path-only. The draft's "storage-damage warnings … are invisible everywhere" / "not emitted at all" doesn't mention this sibling and needs correction before refine.
2. Dedup gap: `docs/backlog/playground/structured-execution-diagnostics.md` (existing draft, `blocked_by: [playground/diagnostics-hub]`) already targets this same underlying gap almost verbatim — "the owner already knows real run exit/error and npm progress/provenance, but the page receives incomplete outcomes … scattered across PTY state, history, stderr, and console" — with its own planned fix (structured owner→page diagnostics contract, ADR-gated). The new draft's `sources`/context never cross-references it despite near-identical problem framing; risks two backlog items independently re-deriving the same "owner has real diagnostics with no page-facing surface" contract.

(Both applied above: severity claim corrected to the prose/success-line
residue; umbrella cross-linked.)
