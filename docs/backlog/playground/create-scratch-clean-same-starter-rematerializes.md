---
area: playground
status: draft
title: Every-load createScratch reseeds a clean same-starter scratch — callers must activate instead
created: 2026-09-01
why: a caller that issues `createScratch({ preserveDirtySameStarter: true })` on every load pays a full erase + re-fetch + re-drain of the persisted tree whenever the scratch is clean — measured 40.7 s on main for a 15.5k-file tree, worse than the 13.4 s cold open; the first-party playground does exactly this on every reload of a `?preset=` deep link
user_story: As a developer reloading a shared `?preset=` playground link (or an embedder reopening the same starter), I want a reload to cost a reopen, but today a clean scratch is reseeded from the starter — persisted tree erased, snapshot fetched, decoded, applied and drained again.
sources: [docs/backlog/vfs/reference/tracker-snapshot-open-split-2026-09-01.md, docs/adr/distribution/0278-playground-companion-terminal-state-and-preview-registry.md, docs/adr/playground/0165-multi-project-management-with-durable-scratch.md]
code: [apps/playground/src/adapters/playground-app.tsx, packages/workbench/src/workers/playground-project-authority.ts]
---

## Context

Contract (ADR-0278, active): `createScratch` with `preserveDirtySameStarter:
true` is an exact no-op only for a **dirty** same-starter scratch; a clean
scratch "reseeds from the supplied definition normally" (owner branch:
`playground-project-authority.ts` `createScratch` — preserve requires
`preserveDirtySameStarter && dirty && baselineMatches`, else `role:
'replace'` → reset). `dirty` is a flag, not a byte proof: seed, dependency
arrival and the git baseline do not mark it (ADR-0278), so a clean scratch
holds the arrived `node_modules` + initial commit that the reseed throws away
and rebuilds.

Measured on main with the real tracker-plugin tree (reference doc, "B. The
embedder's own sequence", clean scratch): reset 18.6 s + re-open 12.2 s +
boot 9.1 s = **40.7 s**, versus 10.0 s for a plain reopen of the same
persisted scratch (variant A: `define` + `openProject`, no catalog mutation).
Frequency is unsized: a dirty scratch (the normal state after one edit)
takes the preserve path and was not measured (Honest limits #5).

The cheap direct route already exists and needs no workbench change:
`catalog.snapshot()` + `activate` on an already-active ref does zero tree
work (`playground-project-authority.ts` `activate`: same active id → return
snapshot). So the defect is caller-side:

- First-party: `apps/playground/src/adapters/playground-app.tsx` parses
  `?preset=` on every load and calls `createScratch(deepLinkStarterId,
  { preserveDirtySameStarter: true })`; the page-side dirty guard reads
  `bound()`, which is null during `initialize`, so reloading a shared deep
  link always reseeds a clean scratch (on the playground's own templates ≈ 1 s;
  on a Tracker-sized tree the 40.7 s above). Fix: consult the catalog snapshot
  and `activate` when a same-starter scratch exists; `createScratch` only
  when none does. No ADR — ADR-0278 semantics unchanged.
- Embedder (tracker4 `openProjectFx`): same pattern; the guidance is one
  sentence in `packages/workbench/README.md` §Storage (rides this capture).
  Not reachable for that embedder until its asset is re-baked against main
  (`playground/baked-snapshot-regeneration`); reachable first-party today.

Not part of `epics/fast-project-open-reopen`: the mechanism is catalog
usage, not storage format; the 12.2 s re-materialize half of the loss is the
same cost goal I1 targets, so the two savings are not additive.

## Challenge

challenge: 2026-09-01 — 6 problems
- [BLOCKING: cheaper direct authority] The value is already reachable with zero workbench change: `catalog.snapshot()` and `catalog.activate` are public (`packages/workbench/src/workbench/playground.ts:122-132`), `activate` on an already-active ref does zero tree work (`playground-project-authority.ts:2496-2507` — `if (activeId(stored.active) === activeId(ref)) return snapshot`), and the evidence doc's own variant A measured exactly that route (`define` + `openProject`, no catalog mutation) at **10.03 s** — i.e. the whole 30.7 s the item claims, obtained by the caller skipping `createScratch` when a matching scratch exists; the draft names this branch but never compares its cost.
- [advisory] "the fix is small in both cases" (draft line 27-28) is false symmetry, and the ADR that makes it false is not in `sources`: ADR-0278 (Accepted, `docs/adr/distribution/0278-playground-companion-terminal-state-and-preview-registry.md` — path expanded from the critic's `0278-…md`) writes the answer verbatim — "`preserveDirtySameStarter` defaults to false. When true and a **dirty** Scratch … `createScratch` is an exact no-op… **A clean Scratch**, a different starter/baseline, or false **reseeds from the supplied definition normally**" — so the no-op branch is an overturn of an active ADR on a published API (`CLAUDE.md` §Decisions: overturn → superseding ADR) plus protocol/controller/contract churn (`playground-owner-protocol.ts:251-261`, `workbench-owner-controller.ts:486-493`), while the other branch is a caller `if`. The draft cites only ADR-0165, whose §6 ("Reset = one-shot WHOLE-workspace re-seed … equivalent to re-picking the Starter") reads *for* the reset answer.
- [advisory] "it is byte-equal to its starter by definition, so nothing is lost" (draft line 25-26) is not supported: `dirty` is a flag, not a byte proof — ADR-0278 states "Seed, **dependency arrival**, and reserved authority metadata do not mark it dirty", and a clean scratch on the measured tree holds 15,568 materialized `node_modules` files plus the git baseline (`ensureStarterInitialCommit`, cold-open table row) that the Starter bundle does not contain; a no-op therefore preserves arrived deps that today's reseed replaces.
- [advisory] Frequency is never sized, and the evidence explicitly refuses to: Honest limits #5 — "The `reopen-embedder` 40.7 s is for a CLEAN scratch. A dirty scratch (**the normal case after the user edits a file**) takes the preserve path and should land near variant A; that was not measured." Dirty is owner-born and persisted in the catalog, so the affected population is only "reopened having never edited anything"; the `why` line asserts the cost "whenever the scratch is clean" without estimating that share.
- [advisory] Not reachable for the named user today: §Blocker — "Current main cannot restore the real asset at all"; with the embedder's shipped 0.4.0 snapshot `openProject` "returns in **295 ms** with NO node_modules", and "Before ANY of this reaches the embedder, the snapshot must be re-baked against main". The 40.7 s exists only on the doctored `T'`; the item carries no `blocked_by: [playground/baked-snapshot-regeneration]` even though the epic's `map.md` lists that re-bake as a separate owner.
- [advisory] Scope is mis-attributed and the magnitude double-counts the epic: (a) the first-party playground hits the same reset — `apps/playground/src/adapters/playground-app.tsx:257` parses `?preset=` from `location.search` on **every** load and line 762-763 calls `createScratch(deepLinkStarterId)` with `preserveDirtySameStarter: true`, while the dirty guard at line 691 reads `bound()`, which is null during `initialize`, so reloading a shared deep-link URL always reseeds (plain reload does not: `initialize` → `runtime.openActive`); the draft frames the finding as embedder-only. (b) "independent of the storage format" (line 30-31) holds for the mechanism but not the number: the 12.2 s re-materialize half of the 30.7 s is exactly what goal `fast-project-open-reopen` I1 targets at ≤ 2.0 s, so the saving is not additive with the epic's.

Disposition (2026-09-01): blocking problem taken — re-shaped from a question
into a caller-side finding (activate when a same-starter scratch exists);
the no-op branch is dropped (ADR-0278 stands). Advisory 2–6 answered above:
ADR-0278 sourced, "byte-equal" withdrawn, frequency stated as unsized,
embedder reachability tied to the re-bake, first-party deep-link path named
as the reachable case, non-additivity with goal I1 stated.
