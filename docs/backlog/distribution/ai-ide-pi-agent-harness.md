---
area: distribution
status: draft
title: Headless AI agent core on Pi over public rifty hosts (Workbench session, no-COI project)
created: 2026-06-13
why: main has zero AI code; PR #111's agent bound to six retired playground seams; the same Pi loop + standard coding-agent tools must run over `@riftydev/workbench` ProjectSession and no-COI `sandbox.project()` with one tool surface
user_story: As a Workbench/SDK embedder, I want to wire a real coding agent (Pi loop, `shell`/file/search/preview tools, per-run budgets, session trace) to my open rifty host and render its event stream in my own UI, but today no such package exists and PR #111's `app-context.ts` seams (terminal-manager, owner-rpc-fs, git-owner-port, ts-ls-client, node-program-lifecycle, preview-bridge-wiring) are gone
epic: ai-agent-mode-and-bench
blocked_by: []
sources: [docs/backlog/epics/ai-agent-mode-and-bench/goal.md, docs/backlog/distribution/reference/ai-agent-mode-refine-evidence.md, M12, docs/research/open-webcontainers-alternative-2026-06.md, docs/adr/distribution/0263-workbench-playground-companion-subpath.md, docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md]
code: [packages/workbench/src/workbench/public.ts, packages/workbench/src/workbench/playground.ts, packages/workbench/src/workbench/project-terminal.ts, packages/workbench/src/workbench/project-files.ts, packages/rifty/src/sandbox-project.ts, tools/checks/arch-rules.cjs]
---

## Context

Rewritten 2026-09-12 as the core child of `epics/ai-agent-mode-and-bench`
(the 2026-06-13 direction — Pi over opencode, AI outside rifty — is carried,
now with PR #111 as quarry: `origin/ai-mode-mvp`, never merged).

Host seams on main (public, proven):

- COI `@riftydev/workbench` `ProjectSession`: `ProjectTerminal.run(line)` +
  `attach` (same pty path a user terminal uses), versioned `ProjectFiles`
  (`readFile`/`writeFile`/`readdir`/`mkdir`/`rename`/`remove`), companion
  `PlaygroundTypeScript` (diagnostics), `PlaygroundScm` (diff), `PlaygroundPreview`.
- no-COI `ToolchainSandbox.project({root, readonlyPaths?, allowedCommands?})`
  (ADR-0418): `project.fs` + `project.run(line)` → `{completion, stop, onOutput}`,
  outcome `exited|cancelled|failed`, worker `retained|replaced|terminated`.
  Same `@riftydev/shell` interprets the line. No diagnostics/SCM companion; no
  `&`, no stdin; `node -e/-p` ⚠️ unproven there (loud subset: `--input-type=module`,
  TypeScript eval, preload, `-p -- <entry>`); one call at a time; every project/command op
  rejects while a `startBin` resident lives (`sandbox.toolchain.resident-concurrency`).

Consequence: ONE tool surface — `shell`, `read_file`, `write_file`,
`edit_file(old,new)` (no fuzzy match), `apply_patch` (unified diff, no fuzz),
`list_files`, `grep`, `glob`, `preview_fetch|query|click|type`, `diagnostics` —
where `diagnostics`/`preview`/`scm` are host capabilities: absent → not offered
to the model and named in the prompt profile; never a stub. The believed
baseline of what `shell` can do per host: evidence file §Baseline.

Integrator seams (user plan validation 2026-09-12, evidence §Plan validation),
all native to Pi 0.85.1: consumer tools = `AgentTool` entries in
`AgentState.tools` (`execute(id, params, signal, onUpdate)`, throw on failure,
per-tool `replay: "never" | "safe"`), project instructions = sections of
`AgentState.systemPrompt`, declared capabilities from the host adapter; transport
= default `pi-ai/api/openai-completions` with `ProviderRequestOptions.fetch`
(consumer fetch: same-origin session, CSRF, body) or a full `Agent.streamFn`
(`(model, context, options) → AssistantMessageEventStream`). Recovery: Pi pushes
each tool result into the context as it completes and records a stream error as
an assistant message (`stopReason: error`), so a failed next request keeps
executed actions in history; cancellation = the same `signal` into `execute` →
host `stop()`; ADR-0418 `worker: replaced` uncertainty rides the tool result.

Pi 0.85.1 (spike 2026-09-12, evidence file): `pi-agent-core` +
`pi-ai/api/openai-completions` bundle for browser ≈120 KB min+gz; static graph
= `openai` SDK + `@earendil-works/chord` (its `esbuild` dep is not in the graph)
+ `pi-telemetry` (no egress); heavy providers absent; ONE static `node:fs`
import in `pi-ai/dist/utils/provider-env.js` (Bun `/proc/self/environ` fallback,
guarded by `typeof process`).

Quarry from #111 (port, do not cherry-pick): `apply-patch.ts`(+test),
`truncate.ts`, `budget.ts`, `prompt-profile.ts`, `trace.ts` schema,
`tools/tool-def.ts`; rewrite: `app-context.ts` → host adapter interface,
`fs-tools.ts` (versioned writes), `shell.ts`, `preview-tools.ts`, `diagnostics.ts`,
`session.ts`.

Carried #111 decisions (user-grilled 2026-07-02, reconfirmed 2026-09-12): Pi
exact-pinned, default transport via the `api/openai-completions` subpath (the
"subpath only" clause is re-cut — Decisions); prompt profile =
Pi baseline + rifty adapter block, versioned, no benchmark tuning; tool results
capped 16 KiB head+tail with `[truncated N bytes]`; per-run limits → distinct
`budget-exceeded`; trace = transcript + tool calls/results + timings + usage +
agent-run terminal output + final diff + config without key; no approve gate;
fresh session per reload.

## Challenge

challenge: 2026-09-11 — 6 problems (goal-level, verbatim in the evidence file; all resolved there)

## Acceptance

1. Real Workbench session: standard file/search/patch tools and dedicated shell,
   consumer tool/instructions/fetch, absent tools omitted with prompt notes;
   public streamFn uses the same retained history/events. → I1, I2
2. Provider error after a completed write retains its result; a new prompt
   continues without automatic replay. Stop settles active and unexecuted calls,
   releases the host command slot and permits another command. → I3
3. Per-run tool/time budgets produce `budget-exceeded`; capped UTF-8 results
   retain head/tail and explicit truncation. Trace includes transcript/events,
   terminal output, timings/usage, host diff and key-free settings. → I4
4. Optional Workbench companion diagnostics match its real results; SCM diff
   appears in export. Host-supplied preview URL/frame supports fetch/query/click/type.
   Absent host capabilities are never implemented as successful stubs. → I1, I4
5. Packed public consumer runs the agent with fixed snapshot deps/no registry,
   failed build → edit → build and real preview HMR. No caller bundler alias. → I1, I7

## Reference contract

Pi core/ai 0.85.1, npm gitHead `d981de1229ef899957bbe968bc8dcda02a21f477`;
`reference/ai-agent-pi-pickup-evidence.md` and retained `ai-agent-pi-oracle.mjs`.
Workbench public ProjectFiles/ProjectTerminal and companion are existing
oracles (ADR-0263/0341); no shell behavior is reimplemented. ADR-0424 records
the public seam, dependency choice, no-auth wire and recovery normalization.

## Parity cases

1. Shell text/exit equals the same ProjectTerminal command; Stop waits for
   physical settlement and close before reuse. → I1, I3, ADR-0341
2. Versioned write is the same owner mutation used by editor save; stale
   versions fail and watched files update the real preview. → I1
3. `edit_file` missing/ambiguous old text and mismatched patch hunks fail loudly;
   diagnostics equal companion syntactic + semantic results. → I1
4. Pi reference write → failed request → prompt retains the prior action;
   missing pending results at Stop become explicit error outcomes, including
   the full custom-stream path. → I2, I3

## Fault matrix

| Boundary / fault | Required result | Carrier |
|---|---|---|
| provider / torn-state after committed write | visible error; history retained | agent-core recovery → I3 |
| host command / cancellation | real Stop and release; pending calls unexecuted with error results | agent-core Stop → I3 |
| provider/tool / unbounded-read | wall-clock abort, byte cap; distinct budget status | agent-core budgets/cap → I4 |
| file / corrupt-input or concurrent edit | exact-match/CAS failure with host effect facts | file tools + packed HMR → I1, I3 |
| capabilities / sibling-drift | current offered tool set and prompt reflect host | browser and embedding proof → I1, I2 |

## Out of scope

- `shell` in a no-COI preview mode (resident alive) → the host's
  `NotImplementedError('sandbox.toolchain.resident-concurrency')` surfaces as the
  tool error; no agent-side queue/retry.
- `sed`/`awk`/`sort`/`xargs`/`npx`, and `|`/`<` inside a background job
  (`shell.pipe`/`shell.input-redirect`) → the shell's own loud errors, both hosts;
  foreground pipes/redirects are real.
- Subagents, product UI, chat persistence, multimodal, provider zoo — goal map.

## Decisions

- 2026-09-12 — PICKUP: ADR-0424; Pi/browser/host API probes and first five real-Workbench REDs captured in `reference/ai-agent-core-evidence.md`; remaining preparation is source/packed carriers for the same clauses, not a scope change.
- 2026-09-12 — ADR at pickup (next-free number) replaces never-merged #111 branch decision record 0190: Pi 0.85.x pin, `node:fs` resolution (alias unreachable or loud), package placement above `workbench` in arch tiers, framework-free.
- 2026-09-12 — first proof = mock OpenAI-compatible streaming endpoint driving a scripted session over a real Workbench `ProjectSession` (browser-unit/e2e), no real model in CI.
- 2026-09-12 — re-cut (user, plan validation): the carried #111 line "provider access ONLY through the `api/openai-completions` subpath" becomes "subpath is the default transport; public `fetch` or `streamFn` seam"; integrator tools/instructions/capabilities are public acceptance, never rifty-side domain actions.
- 2026-09-12 — recovery rows carried for compile at PICKUP (user, plan validation): completed tool calls/results survive a failed next request; after Stop the history continues and partial calls have a defined outcome; cancellation reaches the active host command; Worker replacement uncertainty is visible in result + events; continuation never repeats an action only because it was lost.
- 2026-09-12 — embedding scenarios for compile at PICKUP (mock model, deterministic): fixed deps + no registry access; custom tool + custom transport through the same loop/trace; absent diagnostics/preview → tools not offered; failed build → fix → successful build; provider error after a write → correct continuation; Stop of an active command → next command in the same session.
- 2026-09-12 — parity rows carried from #111 for compile at PICKUP: `shell` stdout/exit == user terminal for the same line; `write_file` on a watched file == editor save (HMR); `edit_file` non-matching `old` → loud string-not-found; `diagnostics` == Problems panel for the same file.
