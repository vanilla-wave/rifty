---
area: distribution
status: draft
title: Cancellable no-COI agent commands and legacy preview question
created: 2026-06-12
why: An agent must stop a command, observe its own output and file effects, then safely submit the next action through the no-COI SDK
user_story: As an embedder, I want invocation-owned output and Stop settlement for real project commands, but runBin returns only an exit code and exposes no per-call cancellation.
sources: [https://github.com/vanilla-wave/rifty/issues/326, docs/backlog/distribution/reference/issues325-326-refine-evidence.md, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0131, ADR-0375, ADR-0376, ADR-0377]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/shell/src/shell.ts]
---

## Reference contract

ADR-0418 fixes the additive public shape. Node/VFS and native Worker evidence,
RED commands and shared packed-consumer scenarios:
`docs/backlog/distribution/reference/pr-331-implementation-evidence.md`.

## Challenge

challenge: 2026-09-10 — clear; unchanged accepted premise/scope reused from
`docs/backlog/distribution/reference/issues325-326-methods-final-green.json`.

## Context

#326 is a static published-0.7.0 audit, not a reproduced regression. The checked
source still has finite `runBin({cwd,binPath,args})`, global runtime output and
whole-Worker restart, without a public cancellable command composition.

Existing Shell supports chunks, cancellation, mutation guards and injected FS.
Default Shell abort may settle before a handler; this alone cannot satisfy Stop
→ next action. COI ProjectRun/ProjectTerminalRun cannot simply be exported into
the shared-memory-free runtime. Research evidence:
`reference/issues325-326-refine-evidence.md`.

## User scenario

A packed SDK consumer embeds an agent without COI. The agent edits a real
project using `distribution/no-coi-project-files`, runs an installed CLI/build
(Vite 7.3.6 is an existing representative, not admission policy), and uses Shell
commands in that same project. The user presses Stop during execution/mutation,
then submits another command. The host identifies each invocation's output,
exit/failure/cancellation and possible file effects, including forced Worker
replacement. A failed command must not poison the next successful command.

Each invocation is a method call, not a persistent shell session. `cd src`
affects subsequent segments of that same command (`cd src && npm run build`),
but a later call takes cwd/env from its own input/configured defaults, never
the preceding command. A run handle owns only output, Stop and completion.
Filesystem effects persist; independent shell state does not mean a fresh JS
realm or rollback of project files.

## Scope

User's conditional choice: ordinary methods have no retained shell state;
a shell instance would retain it. The driver selects ordinary methods, with
existing Shell as their internal interpreter. No public long-lived shell
instance is proposed. Exact method/handle names remain PICKUP API design.

## Acceptance

- Public invocation completion/stop/output exposes unambiguous stdout, stderr, exit/failure and cancellation for the actual command; no private eval globals or control files. → scenario
- Separate method calls do not inherit cwd/env changes, after success, failure or Stop; within-call Shell sequencing still works and applied filesystem effects remain. → scenario
- Stop retains ownership until execution settles or the old Worker is terminated. Next run cannot receive old output/results or claim that still-running work is finished. → scenario
- Applied file effects are reported honestly; cancellation promises no rollback. Failed flush, unacknowledged writes and necessary Worker replacement are explicit; no hidden replay. → scenario
- Existing Shell is usable through the SDK Worker with project root and host-supplied execution/write policy. File tools, builtins/redirections and ordinary installed Node programs agree on paths and readonly constraints; no hostile-code containment claim. → scenario
- Hosts can prohibit background jobs. If admitted, a job's late output/effects and Stop remain owned by its original invocation, never the next command. → scenario
- A real no-COI browser consumer proves run → Stop → next, failed → successful, Stop during filesystem mutation, and file/command policy agreement. → scenario

## Fault matrix

Boundary models: dedicated Worker, in-process policy and storage. Alive Worker
message loss/replay/reorder is excluded, not an excuse for another queue.

| Reachable fault | Required observation | Trace |
|---|---|---|
| cooperative abort while handler/flush still pending | Cancellation is not terminal until actual settlement; already-applied effects remain visible | → scenario |
| CPU-bound/non-cooperative guest; Worker error/close | Physical termination/replacement is explicit; unknown effects stay unknown; next run has separate output ownership | → scenario |
| quota-perm-fail / torn-state during mutation or final flush | Failure cannot become clean success or rollback; recovery never silently repeats the command | → scenario |
| overlapping finite calls | Preserve explicit busy rejection at the existing realm owner; no implicit queue | → scenario, ADR-0376 |
| malformed root/policy or readonly mutation via shell/guest | Consistent rejection at the operation boundary, without silently bypassing policy | → scenario |

## Decisions

- re-cut: 2026-09-10 — #326 refines the existing exec finding in place; historical preview question retained separately below — trace: none.
- 2026-09-10 — reuse one authoritative no-COI Worker/VFS and existing Shell; API shape and any widened admission seam need ADR/reference/RED preparation at PICKUP.
- 2026-09-10 — #326 permits necessary whole-Worker replacement and explicitly rejects cancellation-as-rollback; existing recovery limits remain honest.
- 2026-09-10 — background support need not expand Shell syntax; prohibiting jobs cannot be implemented by ignoring trailing `&`.
- 2026-09-10 — user: ordinary methods must not retain state, shell instances must; driver selects method calls with invocation-only handles, no public persistent shell instance (source: reference/issues325-326-refine-evidence.md).
- 2026-09-10 — no-COI concern retains #326's operation-constraint boundary: ordinary policy checks, cooperative settlement or explicit whole-Worker termination; no hostile-JS security or per-run realm-isolation claim.
- rejected route: expose full Workbench controllers — violates the no-COI scenario (ADR-0375/0377).
- rejected route: signal followed by immediate success, while handler keeps running — violates Stop settlement in the scenario.

## Legacy preview question

The pre-#326 item also asked for normalized preview URLs. It is not deleted or
claimed delivered by command work. Current `toolchain.startBin` already returns
`previewUrl` for one no-COI resident bin (ADR-0377); the original blanket claim
that SDK consumers lack a URL is stale. Whether broader generic sandbox/demo
scenarios need more normalization remains a question for their owner at pickup:
`distribution/ai-sandbox-reference-demo` / `epics/open-bolt-ai-sandbox-demo`.
Their references to this item still include this unresolved preview question.
No preview API or coexistence scope is added by #325/#326. Re-cut this residual
into its own question if command implementation is picked up first.

## Out of scope

LLM providers/prompts/tool schemas, the Stop UI, a second shell implementation,
security isolation for arbitrary guest JavaScript, a new snapshot/fork API and
crash-atomic workspace recovery. Existing resident-bin/finite-run overlap stays
the loud `NotImplementedError('sandbox.toolchain.resident-concurrency')`;
unsupported runtime features retain their compatibility gaps. Raw console eval
does not silently gain cancellation or structured JS return values.
