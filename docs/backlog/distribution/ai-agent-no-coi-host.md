---
area: distribution
status: draft
title: no-COI host adapter for the agent core over `sandbox.project()` with e2e in tests/no-coi
created: 2026-09-12
why: the user's "no COI works" answer; ADR-0418 delivered the no-COI agent SDK (project files + stoppable shell commands) but no agent consumes it and no proof shows the same agent session working over it
user_story: As an SDK embedder without cross-origin isolation, I want the same agent (same prompt profile, same tools) to edit my project and run `npm run build` through `sandbox.project(...)`, pressing Stop and running again, but today the agent core does not exist and nothing binds it to the no-COI SDK
epic: ai-agent-mode-and-bench
blocked_by: [distribution/ai-ide-pi-agent-harness]
sources: [docs/backlog/epics/ai-agent-mode-and-bench/goal.md, docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md, docs/adr/distribution/0377-no-coi-resident-tool-and-restart-lifecycle.md, docs/backlog/distribution/reference/ai-agent-mode-refine-evidence.md]
code: [packages/rifty/src/sandbox-project.ts, packages/rifty/src/sandbox.ts, packages/workbench/src/workers/no-coi-project-command.ts, tests/no-coi/no-coi-agent-installed-cli.spec.ts, tests/no-coi/no-coi-agent-network.spec.ts]
---

## Context

Host facts (ADR-0418/0377, `sandbox-project.ts`): `project.fs` (rooted,
readonly policy) and `project.run(line, {cwd?, env?})` interpreted by the real
`@riftydev/shell` (built-ins, `git`, `node <file>`, `npm run`, installed `.bin`);
`stop()` settles or replaces the Worker (effects reported uncertain); one call
at a time; `allowedCommands` enforced at dispatch; background `&` rejected;
`node -e/-p` ⚠️ (CJS `-e`/`-p <expr>` classify to eval; `--input-type=module`,
TypeScript, preload, `-p -- <entry>` loud; no `tests/no-coi` spec runs it). While a
`startBin` resident lives, every `project-fs`/`command`/`install`/`runBin` op
throws `sandbox.toolchain.resident-concurrency` — the agent as mapped then has
NO file or shell tool, only `preview_*`; raw `sandbox.fs`/`runtime.eval` still
work but bypass root/readonly policy. Two host modes — "preview" and
"commands/build" — switched by the host's `restart`; whether the adapter may
fall back to raw `sandbox.fs` in preview mode is an agent design choice (goal
map fog), never a silent bypass; not a gap this item fixes.

Adapter mapping: `shell` → `project.run` (+ `stop` on abort; outcome
`cancelled`/`failed`/`worker: replaced` surfaced verbatim in the tool result);
file tools → `project.fs`; `preview_*` → the host-supplied resident `previewUrl`
when present; `diagnostics`/`scm` capabilities absent → not offered, named in
the prompt. Hands-on surface: none in v1 (user 2026-09-12: «Только библиотека +
e2e в tests/no-coi»).

## Challenge

challenge: 2026-09-11 — 6 problems (goal-level, verbatim in the evidence file; all resolved there)

## Out of scope

- Commands during preview mode; resident/finite coexistence
  (`distribution/public-api-ai-agent-preview-question`).
- Preview for a `node server.js` started via `project.run` (no bridge; only
  `startBin` residents get `previewUrl`).
- examples/ page, playground no-COI mode.

## Decisions

- 2026-09-12 — proof shape follows `tests/no-coi/no-coi-agent-installed-cli.spec.ts`: packed no-COI page, mock model, scripted session edits the react-vite sources → `npm run build` → Stop mid-run → next command; readonly violation surfaces as a tool error.
