---
area: process-meta
status: active
title: Re-anchor the per-milestone document/backlog review ritual after PROJECT_PLAN retires
created: 2026-06-08
why: PROJECT_PLAN's closing "living document / review-each-milestone" ritual loses its home when the file retires; the explicit per-milestone promote/rollback loop must re-anchor to ROADMAP/CLAUDE
user_story: As a rifty maintainer closing a milestone, I want a canonical promote/rollback ritual to sweep backlog, run `compat:generate`, and flag entries idle >2 milestones as debt, but today that loop only lived in the retired PROJECT_PLAN so it has no home.
sources: [PROJECT_PLAN closing ritual, CLAUDE.md footer]
---
## Context
PROJECT_PLAN closes with a living-document ritual: each milestone ends with a doc review — what was confirmed, what was overestimated; plus the milestone-close provisional-decision pass (CLAUDE.md footer) promoting confirmed ones to ADRs or rolling back rejected ones, flagging entries older than two milestones as debt. CLAUDE.md's footer partially echoes this ("reviewed at the end of each milestone"), but the explicit "review each milestone, promote/rollback" loop disappears with those files. After this refactor, the old OPEN_QUESTIONS entries become `docs/backlog/<area>/<slug>` items, so the ritual must re-point at the backlog + the new ROADMAP/CLAUDE.

## Options / Next
Define the milestone-close ritual in its new home (CLAUDE.md or a slim ROADMAP): at each milestone close — (1) sweep `docs/backlog/` for items whose gate is now met → promote to ADR or close; (2) run `compat:generate` per the DoD; (3) re-anchor stale roadmap/scope to the canonical milestone map (docs/ROADMAP.md → confirm single source); (4) flag backlog items idle >2 milestones as debt. Next step: pick the canonical home and write the ~6-line ritual there, replacing the retired PROJECT_PLAN referent. Escalation noted in digest: the human reserves the doc-layout call (inline in CLAUDE vs new VISION/ROADMAP).

## Reversibility
REVERSIBLE — process wording + doc placement. No code/API. The doc-layout choice (where vision + ritual live) is the human-reserved judgment call flagged in the audit escalation.
