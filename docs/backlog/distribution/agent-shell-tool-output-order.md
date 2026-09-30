---
area: distribution
status: ready
title: Present a command's stdout and stderr to the model in the order they were produced
created: 2026-09-27
why: the shell tool's text concatenates all stdout then all stderr, so build errors lose their position relative to the progress lines around them while the streaming events keep the real order
epic: no-coi-agent-host-kit
sources: [ADR-0436, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/agent/src/tools.ts, packages/rifty/src/sandbox-project.ts]
---

## Context

Finding (fidelity audit row 17). `packages/agent/src/tools.ts:319` builds the
shell tool result as `${outcome.stdout}${outcome.stderr}` from
`SandboxCommandOutcome` (`sandbox-project.ts:24-32`), whose two strings are
per-stream accumulations; the `output` events (`AgentSessionEvent`
`type:'output'`) and a terminal keep the interleaving. ADR-0436 D4 fixes the
status/exit/error header before the body; ordering inside the body is
unrecorded. `no-coi-pi-agent.spec.ts:62-67` asserts the events, not the text.

Goal obligation: I10 — the text after the status line presents the chunks in
production order, as the events and a terminal do.

## Out of scope

- The 16 KiB head/tail cap (`agent-tool-text-cap-and-run-budgets-measure`).
- Terminal rendering; `RiftyTerminal` is unaffected.

## User scenario

Run a shell command writing stderr/stdout/stderr/stdout; the next model request
and transcript preserve the same order as the emitted terminal events.

## Challenge

challenge: 2026-09-30 — clear; reuse goal fidelity audit I10 and accepted
terminal-order obligation; observed defect repair adds no new premise.

## Acceptance

1. Successful and nonzero commands keep terminal order in model text after the
   unchanged status heading; structured per-stream outcomes remain. → I10

## Decisions

- 2026-09-30 — observed baseline defect; RDY-8 repair route. Executed RED and sibling sweep: `reference/agent-shell-tool-output-order-evidence.md`.
- 2026-09-30 — capture existing output events at their shared tool shaping point; no new outcome API.
