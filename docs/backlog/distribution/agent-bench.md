---
area: distribution
status: ready
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

## Reference and scope

Goal I8/scenario4, raw refine/FIT frontier and five unchanged PR-111 user prompts.
Core/no-COI/+chat are final-checked; current BASE is UI Final+GREEN0bcf3340b.
Native Pi CLI0.85.1 no-auth/header and pre-execution budget hooks were executed,
not assumed; preparation in `reference/agent-bench-pickup-evidence.md`.
ADR-0434 fixes agent-owned packaging/profile/report choices. The existing
accepted premise and user tool/context caveat remain; no scope fork is open.

## Acceptance

1. `pnpm agent-bench` runs fix-date-sort, add-search, url-filters,
   new-issue-form and node-endpoint, default three cold runs per supported lane.
   React tasks use current react-vite source; node control uses current hono-api.
   Task prompts and seed overlays are shared; one judge per task observes actual
   DOM/API outcomes. New-issue judge includes the requested required-title error.
   → I8 + scenario4
2. Lane rifty types the exact task prompt into the real +chat UI and uses only
   opt-in seed/export/metadata hooks; terminal, source/SCM and preview are real.
   Lane rifty-no-coi loads a page built from packed public SDK/agent packages,
   without source aliases or COI headers; public project fs/commands carry the
   agent, host-owned resident mode carries common preview judging. Four React
   tasks only; node control exclusion is explicit. → I8 + I5 + I6
3. Lane local-reference uses a fresh temporary project, real npm/Node and pinned
   Pi CLI0.85.1. Public native hooks handle optional/no-auth transport and budget
   admission. Same model and common coding profile; actual tool/host/full-prompt
   differences are recorded and named as non-equivalent context. The core's
   default assembled prompt remains unchanged when its shared policy is exposed.
   → I8 + I2 + ADR-0434
4. All three lanes complete mock-model smoke before live runs. Model-only HTTP
   simulation reads package.json then ends; original planted defects remain.
   The common judges produce byte-identical canonical evidence per task across
   supported lanes. Real traces/builds/browser artifacts support lane execution;
   a fabricated report or skipped judge is not a smoke pass. → I8
5. Common maxToolCalls/runTimeoutMs limits are per run. Excess native CLI tools
   are blocked before their effects; active work is stopped at the deadline.
   Reports distinguish done/error/abort from artifact judgment and preserve
   budget-exceeded as its own outcome. Provider/tool/setup/judge failures retain
   their actual evidence and previously completed run records. → I8 + I4
6. JSON/Markdown report includes model/profile/task-set/endpoint/limits, per-run
   time/turns/tool calls/terminal tail/final diff/preview probes and per-task
   lane delta versus local-reference. Failure class/note are assigned after
   human inspection (agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider,
   task-bad), retained by report regeneration. No automatic runtime attribution,
   no key in persisted config, transcripts or reports. → I8 + I2 + I4
7. Run the complete real matrix: five tasks × three runs in rifty/local-reference,
   four React tasks × three runs in rifty-no-coi, one configured model/profile.
   Commit a diagnostic summary with evidence/classification; unsuccessful model
   task outcomes remain honest measurements, not altered judges or CI failures.
   → I8 + scenario4
8. Resolve the goal map's existing baseline questions with real lane evidence:
   tsc via .bin/vitest, no-COI node -e/-p/builtins/git/foreground pipes, and the
   UI live React declaration diagnostic observation. Distinguish missing deps,
   declared unsupported behavior and reproduced defects; route by obligation.
   → I8 + ADR-0434

## Parity cases

1. Each common task judge executes on actual lane programs; mock evidence is
   identical after excluding origin/timestamp differences, and positive native
   controls discriminate all requested task outcomes. → I8
2. Shared policy identity/prompt paragraphs are verified against actual provider
   requests/native assembled context; CLI tool/transport differences remain
   recorded, never treated as proven environment-only equivalence. → I8

## Fault matrix

| Boundary / fault | Honest outcome | Carrier |
|---|---|---|
| run / budget exhaustion | explicit budget outcome, native admission/abort, no extra tool effects | CLI native hook probe + actual lane limit runs → I8 + I4 |
| provider/tool after effects / torn-state | actual error and retained trace/diff; no invented completion | external scripted failure + run report → I8 + I4 |
| install/judge / failure | failure stage/evidence retained; completed records survive | real lane failures + report regeneration → I8 |
| profile/task/lane / sibling-drift | actual shared inputs, common judges, real public hosts; differences visible | all-three mock smoke + native controls + captured traces → I8 |
| config/export / corrupt input or secret disclosure | invalid config fails explicitly; key remains memory-only/redacted | config/transport and artifact checks → I8 + I2 |

## Out of scope

- auto-classification of failures; a leaderboard; `node-endpoint` in lane `rifty-no-coi`.
- Prompt-baseline research for other agents (Codex/Claude Code style) — remembered, not an item.

## Decisions

- 2026-09-13 — PICKUP: unchanged goal/source premise reused; ADR-0434 owns shared policy metadata, public native CLI hooks and host-owned no-COI preview; default common limits40 calls/600000ms, three cold runs, no tool-specific timeout promise.
- 2026-09-13 — callable RED scaffold and on-demand real-lane acceptance carrier; native CLI probes and explicit baseline measurement remain in reference evidence.

- 2026-09-12 — ADR at pickup (next-free number) replaces never-merged #111 branch decision record 0191 with the same decisions; reports land in `tools/agent-bench/reports/` (gitignored except committed summaries); no secrets in traces.
- 2026-09-12 — user (plan validation): the report interprets the `local-reference` delta — a shared model + Pi version does not prove tool/context equivalence with the Pi CLI; observed delta is classified, never auto-attributed to the rifty runtime. Embedding scenarios (custom tool/transport, absent capabilities, failed build → repair, provider error after write, Stop → next) are deterministic acceptance of the core/no-COI children, not bench tasks.
- 2026-09-12 — `node-endpoint` control task is COI-only by construction (a user `server.js` gets no preview in no-COI) — recorded, not a bench finding.
