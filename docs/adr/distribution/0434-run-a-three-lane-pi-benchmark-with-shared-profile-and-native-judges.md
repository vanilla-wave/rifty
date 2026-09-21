# ADR 0434: Run a three-lane Pi benchmark with shared profile and native judges

Status: Accepted
Date: 2026-09-13

## Context

Goal I8 carries the five PR-111 tasks, three cold runs and a diagnostic report.
It explicitly adds packed no-COI for the four React tasks and rejects automatic
attribution of quality delta to the runtime. This replaces the never-merged
branch decision record0191, not an active main ADR. Core/hosts/UI are delivered.

## Decision

1. A private workspace tool owns CLI/config, task data/common judges, lane
   adapters and report files. Runtime/apps never import the harness. User prompts
   are unchanged; judges target the current #300 DOM and Hono message API.
2. Rifty lane uses actual +chat controls and only its opt-in seed/export/metadata
   hooks. Capture real Playwright trace. No direct core send behind the UI.
   No-COI page is built against packed public SDK/agent packages, with copied
   SDK worker/SW assets and no source aliases. Public project fs/commands own
   setup/agent operations; host starts the resident preview for common judging.
   Native lane uses real npm/Node in a new temporary project and Pi CLI0.85.1,
   with isolated Pi home and no user context/extensions discovered.
3. Export getAgentPromptProfile from the agent's public index: id, intro,
   guidance, recovery and verification text. Core consumes those same existing
   paragraphs without changing its default assembled prompt. CLI composes the
   common policy with its actual native tool/host facts. Record actual full
   prompts and shared policy identity; full tool/context equivalence is not
   asserted. No benchmark-specific prompt or task-specific tuning in core.
4. Config carries endpoint/model and optional key environment-variable name;
   user key stays memory-only and redacted from reports/artifacts. No-auth CLI
   uses a nonsecret provider sentinel and its public before_provider_headers
   hook to remove Authorization. Browser action tracing starts after key entry,
   with DOM/network snapshots and source capture disabled for no-auth runs.
   Keyed runs omit raw browser tracing/screenshots and retain redacted textual
   evidence: native console/action payloads can also contain keys.
   Native tool_call/ctx.abort hooks enforce the
   same per-run tool/time limits before excess execution. Budget evidence is
   explicit: native CLI exit0 alone is not completion or quality proof.
5. Cold workspace per task/run; default three runs. Same common judge executes
   for each supported lane. Mock model reads package.json and ends: smoke proves
   real plumbing and identical baseline judge evidence, not solved tasks. Real
   run statuses and artifact judgment stay distinguishable; budget-exceeded
   has its own outcome. Failures retain evidence and require human class/note.
6. JSON + Markdown report includes model/profile/task-set/endpoint/limits,
   per-run elapsed/turns/tools/terminal/diff/preview evidence and per-task delta.
   Unsupported node-endpoint/no-COI is explicitly absent, never counted as fail.
   CLI report regeneration preserves manual annotations. Diagnostic runs stay
   on demand; paid runs are not CI. All three smoke lanes precede real runs.

## Alternatives

- Reuse the quarry unchanged: retired adapters/judges, required key and false
  environment-only attribution do not meet I8.
- Separate core calls for the COI lane: loses the accepted real chat path.
- Wrap/replace Pi's loop: native public hooks already prove no-auth and budget
  admission; existing core remains the sole browser loop.
- New provider proxy or mode broker: unnecessary. Public hooks and existing
  host-owned commands/preview modes meet the contract.

## Evidence

Native CLI/schema/header/budget probes and source→scope record:
`docs/backlog/distribution/reference/agent-bench-pickup-evidence.md`.

## Corrections (active)

2026-09-18 — ADR-0440 supersedes decision 3's unchanged assembled-prompt
clause. Shared profile id/paragraphs remain unchanged; resource blocks and
custom-prompt tail order now apply to every consumer.
