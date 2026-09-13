---
area: distribution
status: draft
title: agent-bench — external harness with lanes rifty (COI chat), rifty-no-coi (headless SDK) and local-reference (Pi CLI) over the #300 react-vite template
created: 2026-09-12
why: "where does rifty lose coding-agent quality vs a real local environment" is still anecdote; PR #111's harness (`tools/agent-bench`, decision record 0191 on that branch) never merged and its judges target the retired #111 template
user_story: As the rifty maintainer, I want `pnpm agent-bench` to run one task suite through the real playground chat (lane `rifty`), through the headless agent over a packed no-COI `sandbox.project()` page (lane `rifty-no-coi`) and through a local temp dir + real npm + pinned Pi CLI (lane `local-reference`) with the same model and prompt profile, and read a per-run failure class, but today no harness, tasks or judges exist on main
epic: ai-agent-mode-and-bench
blocked_by: []
sources: [docs/backlog/epics/ai-agent-mode-and-bench/goal.md, docs/backlog/distribution/reference/ai-agent-mode-refine-evidence.md, docs/backlog/playground/react-vite-starter.md]
code: [apps/playground/src/templates/react-vite, tests/e2e/react-vite-preset.spec.ts, tools/perf/bench.mjs, playwright.config.ts, pnpm-workspace.yaml]
---

## Context

Carried #111 design (branch decision record 0191) (user-grilled 2026-07-02): harness OUTSIDE rifty
in `tools/agent-bench` (workspace tool, never imported by packages/apps; own
Playwright config, not a CI lane — costs real tokens, diagnostic not gate);
one suite, one adapter per lane; lane `rifty` types the prompt into the real
chat UI; hooks only
`__riftyAgentBench` under `?agentBench=1`; tasks user-shaped
(`tasks/<slug>/prompt.md` + `seed/` overlay + `judge.ts` via Playwright APIs);
diagnostic-first report (pass/fail, elapsed/turns/tool calls, terminal tail,
final diff, preview probes, human failure class + note; per-task delta; header
model/profile/task-set/endpoint/limits); `budget-exceeded` ≠ fail; reset = cold
start only; 3 runs/task/lane.

Re-cut on main: the 5 tasks stay (`fix-date-sort`, `add-search`, `url-filters`,
`new-issue-form`, `node-endpoint`) — the #300 template plants the same four
rough edges (`templates/react-vite/project.ts`); judges are re-authored against
its DOM/routes; lane `rifty` drives the "+chat" panel; lane `rifty-no-coi`
(user 2026-09-12: «Да, no-COI lane в v1») drives the headless core over
`sandbox.project()` in a packed no-COI page — the 4 React tasks, judged by the
same `judge.ts` through the resident `previewUrl`; `local-reference` pins
`@earendil-works/pi-coding-agent` to the core's Pi version (0.85.x). Mock-model
smoke must run end-to-end on all three lanes (`rifty`, `rifty-no-coi`,
`local-reference`) with byte-identical judge evidence across lanes (as #111
proved for two) before a real endpoint is used.

Believed baseline the bench validates (evidence file §Baseline): ⚠️ rows —
`tsc --noEmit` via `.bin` and vitest under rifty (all rifty lanes); `node -e/-p`,
shell built-ins, `git`, foreground pipes in no-COI (lane `rifty-no-coi`).

Quarry: `origin/ai-mode-mvp:tools/agent-bench/**` (`mock-model.ts`, `report.ts`,
`runner.ts`, `config.ts`, `local-reference.ts`, `tasks/*/prompt.md` port;
`lanes/rifty.ts`, `tasks/*/judge.ts`, `seed.ts`, `templates.ts` rewrite).

## Challenge

challenge: 2026-09-11 — 6 problems (goal-level, verbatim in the evidence file; all resolved there)

## Out of scope

- auto-classification of failures; a leaderboard; `node-endpoint` in lane `rifty-no-coi`.
- Prompt-baseline research for other agents (Codex/Claude Code style) — remembered, not an item.

## Decisions

- 2026-09-12 — ADR at pickup (next-free number) replaces never-merged #111 branch decision record 0191 with the same decisions; reports land in `tools/agent-bench/reports/` (gitignored except committed summaries); no secrets in traces.
- 2026-09-12 — user (plan validation): the report interprets the `local-reference` delta — a shared model + Pi version does not prove tool/context equivalence with the Pi CLI; observed delta is classified, never auto-attributed to the rifty runtime. Embedding scenarios (custom tool/transport, absent capabilities, failed build → repair, provider error after write, Stop → next) are deterministic acceptance of the core/no-COI children, not bench tasks.
- 2026-09-12 — `node-endpoint` control task is COI-only by construction (a user `server.js` gets no preview in no-COI) — recorded, not a bench finding.
