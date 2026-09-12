---
area: distribution
status: ready
title: no-COI host adapter for the agent core over `sandbox.project()` with e2e in tests/no-coi
created: 2026-09-12
why: the user's "no COI works" answer; ADR-0418 delivered the no-COI agent SDK (project files + stoppable shell commands) but no agent consumes it and no proof shows the same agent session working over it
user_story: As an SDK embedder without cross-origin isolation, I want the same Pi agent to edit my project, build, inspect preview, leave preview and edit again through the public project policy
epic: ai-agent-mode-and-bench
blocked_by: []
sources: [docs/backlog/epics/ai-agent-mode-and-bench/goal.md, docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md, docs/adr/distribution/0377-no-coi-resident-tool-and-restart-lifecycle.md, docs/backlog/distribution/reference/ai-agent-mode-refine-evidence.md]
code: [packages/rifty/src/sandbox-project.ts, packages/rifty/src/sandbox.ts, packages/workbench/src/workers/no-coi-project-command.ts, tests/no-coi/no-coi-agent-installed-cli.spec.ts, tests/no-coi/no-coi-agent-network.spec.ts]
---

## Context

Pickup baseline @ 523628b0c (ADR-0418/0377, `sandbox-project.ts`): `project.fs` (rooted,
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
"commands/build" — entered by the host's `startBin`; NOT left by `restart`
(it re-runs the resident, ADR-0377 D3; `SandboxResidentBin` has no stop) — on
main preview mode ends only with `dispose()` + fresh boot. The host owns the
switch, but the exit is an open substrate (goal map fog); the adapter exposes the current capability
set and the agent observes the change (tool set + prompt note; Pi allows
reassigning `state.tools` mid-session). Raw `sandbox.fs` fallback is excluded
from the standard adapter (user, 2026-09-12). Resident/finite coexistence is not
a gap this item fixes.

Adapter mapping: `shell` → `project.run` (+ `stop` on abort; outcome
`cancelled`/`failed`/`worker: replaced` surfaced verbatim in the tool result);
file tools → `project.fs`; `preview_*` → the host-supplied resident `previewUrl`
when present; `diagnostics`/`scm` capabilities absent → not offered, named in
the prompt. Hands-on surface: none in v1 (user 2026-09-12: «Только библиотека +
e2e в tests/no-coi»).

## Challenge

challenge: 2026-09-11 — 6 problems (goal-level, verbatim in the evidence file; all resolved there)

## Reference contract

- Public SDK ADR-0418 owns project paths/policy, command output/completion and
  Stop's retained/replaced Worker effects. Existing executed reference:
  `docs/backlog/distribution/reference/pr-331-implementation-evidence.md`;
  `tests/no-coi/no-coi-agent-sdk.spec.ts` and installed CLI scenario.
- ADR-0377 owns whole-realm restart, replay, activation recovery and dirty
  reporting. The new exit reuses that owner; `no-coi-resident-exit.spec.ts`
  starts a real Node HTTP bin, proves current replay, then targets the new exit.
- Pi 0.85.1 loop/prompt/transport and recovery proof inherited unchanged from
  core Final+GREEN @ 523628b0c. No-COI mapping adds no second loop/state owner.
  Public surface and alternatives: ADR-0426; RED/proof record:
  `docs/backlog/distribution/reference/ai-agent-no-coi-evidence.md`.

## Acceptance

1. `createSandboxAgentHost` binds public project files/search/edit and shell to
   the same Pi session. Readonly, command allowlist and file-root escape fail
   without changing protected files; absent diagnostics/SCM/preview are omitted
   and named. Real Worker policy scenario in `no-coi-pi-agent.spec.ts`. → I6
2. Provider failure after a completed write retains results; continuation sees
   them and executes only its next command. Same model-only fake, real files
   and Worker. → I3 + I7
3. Stop settles a cooperative command or physically replaces a CPU-wedged
   Worker before returning; result/events retain native uncertainty and skipped
   batch calls. The next command succeeds on the same agent/project handle. → I3
4. React starter cycle on a headerless browser: agent edits → npm build → host
   startBin → agent preview fetch/DOM → host stopResident → agent edits to a
   real syntax error → failed build → repair/build → rendered repaired preview.
   Each model turn observes the current mode's tools/prompt. Direct project
   read/command during preview stays loudly denied. → I6 + I7
5. Public stopResident returns resident null, retains acknowledged project
   files, clears replay intent and shares restart's overlap rejection. Existing
   restart still relaunches until explicit exit. → I6 + ADR-0377 + ADR-0426
6. Packed public agent/SDK imports run the mode cycle in a no-COI page using
   the existing producer Vite snapshot, with no runtime registry acquisition.
   Source React acceptance and packed import/activation acceptance compose;
   all three benchmark lanes remain the later measurement child. → I6 + I7

## Parity cases

1. Adapter shell preserves the public SDK completion fields, streamed bytes,
   retained/replaced Worker and effects for the same command; no shell facade
   changes cwd/env between native invocations. → I3 + I6 + ADR-0418
2. File policy failure preserves the SDK failure facts; ordinary project
   read/transform/write never claims Workbench CAS or rollback. → I6 + ADR-0418

## Fault matrix

| Boundary / fault | Honest outcome | Proof / trace |
|---|---|---|
| provider / torn-state after write | retained write/results, explicit provider error | policy scenario → I3 |
| command / cancellation | await real cooperative settlement; skipped call error; next command | soft Stop scenario → I3 |
| Worker / peer-loss from forced Stop | physical replacement, unknown effects, no replay | hard Stop scenario → I3 |
| file and shell / corrupt-input against policy | denied write/command leaves protected files unchanged | policy scenario → I6 |
| host modes / sibling-drift | new tools/prompt; stale project operations fail at owner | React cycle → I6 |
| replacement / torn-state or overlap | same restart owner/report, no competing generation or resident replay | resident exit + existing restart suite → I6 + ADR-0377 |

## Out of scope

- Commands during preview mode; resident/finite coexistence
  (`distribution/public-api-ai-agent-preview-question`).
- Preview for a `node server.js` started via `project.run` (no bridge; only
  `startBin` residents get `previewUrl`).
- examples/ page, playground no-COI mode.

## Decisions

- 2026-09-12 — PICKUP reuses the final-checked goal/source frontier and unchanged premise; ADR-0426 chooses a public adapter and explicit exit over the existing replacement owner; core delivered @ 523628b0c. Original substrate question is resolved by this unit, not a user stop.
- 2026-09-12 — proof shape follows `tests/no-coi/no-coi-agent-installed-cli.spec.ts` / `tests/integration/no-coi-agent-browser-proof.mjs`: packed no-COI page, mock model, scripted session edits the react-vite sources → `npm run build` → Stop mid-run → next command; readonly violation surfaces as a tool error.
- 2026-09-12 — user (plan validation): one e2e proves the full cycle edit → build → preview (host `startBin`, agent `preview_*`) → host ends the resident → edit → failed `vite build` → fix → successful build; the agent sees each capability change; commands/project fs in preview mode surface the host's loud error, never a raw-fs bypass. Blocker recorded: no public resident exit on main (`restart` re-runs it) — a host-side exit is new SDK surface → ADR at pickup, or the e2e stops at the loud `resident-concurrency` error and names the gap.
