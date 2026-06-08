---
area: process-meta
status: active
title: Re-anchor the per-milestone document/OPEN_QUESTIONS review ritual after PROJECT_PLAN retires
created: 2026-06-08
why: PROJECT_PLAN's closing "living document / review-each-milestone" ritual loses its home when the file retires; the explicit per-milestone promote/rollback loop must re-anchor to ROADMAP/CLAUDE
sources: [PROJECT_PLAN closing ritual, D-007 review process, ADR-0063, ADR-0064, CLAUDE.md footer]
---
## Context
PROJECT_PLAN closes with a living-document ritual: each milestone ends with a doc review — what was confirmed, what was overestimated; and (D-007) a pass through provisional decisions promoting confirmed ones to ADRs or rolling back rejected ones, flagging entries older than two milestones as debt. CLAUDE.md's footer partially echoes this ("reviewed at the end of each milestone"), but the explicit "review PROJECT_PLAN/OPEN_QUESTIONS each milestone, promote/rollback" loop disappears with those files. After this refactor, OPEN_QUESTIONS entries become backlog items, so the ritual must re-point at the backlog + the new ROADMAP/CLAUDE.

## Options / Next
Define the milestone-close ritual in its new home (CLAUDE.md or a slim ROADMAP): at each milestone close — (1) sweep `docs/backlog/` for items whose gate is now met → promote to ADR or close; (2) run `compat:generate` (see compat-generate-on-milestone-dod); (3) re-anchor stale roadmap/scope to the canonical milestone map (docs/ROADMAP.md → confirm single source); (4) flag backlog items idle >2 milestones as debt. Next step: pick the canonical home and write the ~6-line ritual there, replacing the retired PROJECT_PLAN referent. Escalation noted in digest: the human reserves the doc-layout call (inline in CLAUDE vs new VISION/ROADMAP).

## Reversibility
REVERSIBLE — process wording + doc placement. No code/API. The doc-layout choice (where vision + ritual live) is the human-reserved judgment call flagged in the audit escalation.
