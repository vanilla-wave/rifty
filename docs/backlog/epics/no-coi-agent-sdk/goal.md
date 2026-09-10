---
kind: epic
status: ready
title: No-COI agent project files and commands
created: 2026-09-10
value: An embedded agent edits and executes a real project through public SDK methods without COI
user_story: As an SDK embedder, I want structured file tools and stoppable stateless command calls over the same project
tier: works
---

## Outcome

Deliver both accepted #325/#326 contracts in PR #331 and green CI.
Original source/conditional user answer: docs/backlog/distribution/reference/issues325-326-refine-evidence.md.

## User scenario

A packed SDK consumer without COI lists, reads, inspects, creates, edits, renames
and removes real project files, runs installed CLI/build and Shell commands,
presses Stop, then runs again. Output/completion belong to each invocation;
root/readonly constraints agree across file tools and ordinary guest programs.
Calls have independent cwd/env; sequencing within a call and file effects persist.
Failure, persistence uncertainty and necessary Worker replacement stay explicit.

## Invariants

Baseline main ca4f47862 lacks sandbox.project and structured RuntimeFs operations;
executed evidence: docs/backlog/distribution/reference/pr-331-implementation-evidence.md.

1. I1 — Public structured project filesystem operations work on the guest Worker VFS with shared root/readonly semantics; raw FS remains VFS-rooted.
2. I2 — Method calls run real Shell/installed programs with invocation-owned output, terminal result and Stop; cwd/env never leak to later calls.
3. I3 — Stop owns execution through actual settlement or physical Worker replacement; applied/uncertain files and failed persistence are explicit, without replay/rollback.
4. I4 — Packed no-COI browser acceptance proves file/command policy agreement, run–Stop–next and failure–success; PR #331 CI is green.

## Challenge

challenge: 2026-09-10 — clear; reuse checked unchanged #325/#326 premise and final scope check at cab32293352e759d7c16cfe2f315da2cd722e464, docs/backlog/distribution/reference/issues325-326-methods-final-green.json.

## Decisions

- 2026-09-10 — tier works retains ADR-0377 honest errors/uncertainty, no crash-atomic recovery; original reachable faults still get proof.
- 2026-09-10 — user: «Результат запушь в него же и доведи ci до зеленого»; one PR #331, no merge requested.
- rejected route: eval/control files — violates I1 and the accepted scenario.
- rejected route: persistent public shell — violates I2 and the user's methods condition.
