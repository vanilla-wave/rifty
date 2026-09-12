---
kind: epic
status: draft
title: AI agent mode over rifty hosts + agent-bench (revives PR #111)
created: 2026-09-12
value: One headless AI coding agent runs over any rifty host (COI Workbench session or no-COI SDK project) with the same tool surface; the playground offers it hands-on; an external two-lane bench reports where rifty loses coding-agent quality vs a real local environment, classified per run
user_story: As the rifty maintainer and as a Workbench/SDK embedder, I want a real coding agent (Pi loop, standard coding-agent tools, honest budgets, session trace) over my rifty host plus a measured rifty-vs-local delta, but today main has zero AI code and PR #111's agent binds to six retired playground seams
---

## Outcome

Diagnostic stand + hands-on AI mode, rebuilt "по мотивам" PR #111 on current
main. Two of #111's three pillars already landed in re-cut form and are NOT this
goal: real esbuild (ADR-0226) and the react-vite starter with the same four
planted rough edges (PR #300). What remains: (1) a headless, framework-free
agent package — Pi loop + standard coding-agent tools + per-run budgets + trace —
consuming only public rifty host APIs; (2) host adapters for `@riftydev/workbench`
`ProjectSession` (COI) and no-COI `sandbox.project()` (ADR-0418), same prompt
profile and tool surface, capabilities the host lacks are not offered to the
model and are named in the prompt; (3) the playground "+chat" reference UI;
(4) `tools/agent-bench`: one task suite, lanes `rifty` (COI playground chat via
Playwright), `rifty-no-coi` (headless agent over `sandbox.project()` in a packed
no-COI page; the 4 React tasks) and `local-reference` (temp dir + real npm + Pi
CLI, same model + prompts), report with human failure class per run. AI stays outside `@riftydev/*`
runtime packages (M12 litmus); rifty grows only AI-agnostic capability.

## User scenario

1. Maintainer: open playground → `react-vite` starter → AI mode → "add search by
   title and keep filters in the URL" → agent edits files, runs `npm run build`
   in the visible agent terminal, checks the preview → SCM shows the diff →
   "Export session" downloads the trace JSON (no key inside).
2. Workbench embedder (COI): wire the agent to an open `ProjectSession`; the
   same session's terminal/files/preview serve the agent; the consumer renders
   its own UI from the agent's event stream.
3. SDK embedder (no-COI): wire the agent to `sandbox.project({root, readonlyPaths,
   allowedCommands})`; agent edits → `npm run build` → Stop → next command;
   proven by e2e in `tests/no-coi` (no hands-on page in v1 — user choice).
4. Bench: `pnpm agent-bench` runs the 5 #111 tasks × lanes `rifty`/`local-reference`
   (4 React tasks × `rifty-no-coi`) × 3 runs with the same model/prompt profile;
   report: pass rate, per-lane delta vs `local-reference`, failure class (`agent / rifty-runtime / rifty-tooling / ai-mode-ux / provider /
   task-bad`) + evidence per run; `budget-exceeded` distinct from fail.

## Invariants

<!-- Drafted at FIT from Outcome/User scenario/Decisions — never new scope.
     Each checked false on current main (evidence comment above the list). -->

## Challenge

challenge: 2026-09-11 — 6 problems (fresh critic, verbatim in
`docs/backlog/distribution/reference/ai-agent-mode-refine-evidence.md` §Challenge;
all six resolved by user answers or facts below, second round + final check in
the same file)

## Decisions

- 2026-09-12 — user: «должно быть возможно использовать при использовании workbench» → headless package over public host APIs; playground consumes it.
- 2026-09-12 — user: «no COI works. Скорее в формате "агент правит исходники, а потом из них можно что-то собрать"» → no-COI host adapter over ADR-0418 `sandbox.project()`; resident-concurrency (no project fs/commands while a `startBin` resident lives; only `preview_*` remains) = two host modes (preview / commands) switched by `restart`, not a gap to fix here.
- 2026-09-12 — user: «без апрува» → no approve gate for writes/shell.
- 2026-09-12 — user: «Headless + playground «+chat» (Recommended)» → agent cut: no "vibe" layout (layout-only difference per #111, REV-7).
- 2026-09-12 — user: no-COI hands-on = «Только библиотека + e2e в tests/no-coi» → no examples page, no playground no-COI mode.
- 2026-09-12 — user: API key: «Ждем ендпоинта без авторизации» → `apiKey` optional, never persisted; playground persists `baseUrl`/`model` only.
- 2026-09-12 — fact (ADR-0418, PR #331): the same `@riftydev/shell` interprets commands in both hosts → ONE tool surface (`shell`, `read_file`, `write_file`, `edit_file`, `apply_patch`, `list_files`, `grep`, `glob`, `preview_*`, `diagnostics`); `diagnostics`/`scm` are host capabilities absent in no-COI — not offered, named in the prompt profile; never a silent stub.
- 2026-09-12 — bench: the 5 #111 tasks stay; judges re-authored on the PR #300 template; lanes `rifty` (COI playground chat), `local-reference`, and — user: «Да, no-COI lane в v1» — `rifty-no-coi` (headless over `sandbox.project()`, 4 React tasks; `node-endpoint` is COI-only by construction).
- 2026-09-12 — Pi 0.85.1 spike (evidence file): browser bundle ≈120 KB min+gz, heavy providers absent, one static `node:fs` import in `pi-ai/utils/provider-env.js` → resolved at core pickup; a stub must be unreachable or loud, never a `''`/`undefined` env answer.
- 2026-09-12 — #111 branch decision records 0190/0191 exist only on `origin/ai-mode-mvp` (never merged): core pickup writes new ADRs at next-free numbers ("replaces the never-merged branch ADRs"), absorbing draft `distribution/ai-ide-pi-agent-harness` (now this goal's core child).
- 2026-09-12 — carrier: workspace package above `workbench` in `tools/checks/arch-rules.cjs` tiers, framework-free (D-002 keeps solid in playground); npm publication is a separate confirm-first act (DEC-3; `@riftydev/git`/`ts-language-service` precedent still unpublished).
- 2026-09-12 — tier: agent-fitted at FIT (`works` proposed: honest happy path, reachable faults loud), not a user fork (critic P4).
- rejected route: rebuild inside `apps/playground` only (as #111) — violates user answer "usable with workbench".
- rejected route: fold into `epics/open-bolt-ai-sandbox-demo` — that epic is a demo page + outbound acts with its own preview question; this goal delivers the agent library it can consume (its 2026-09-11 baseline note already points at ADR-0418).
- rejected route: hand-rolled loop / Vercel AI SDK as primary — breaks the same-loop-both-lanes bench premise; stays the recorded fallback if Pi proves browser-unclean.
