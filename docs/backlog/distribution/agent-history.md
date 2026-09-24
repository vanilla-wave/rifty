---
area: distribution
status: draft
title: Restore native agent history in fresh headless sessions
created: 2026-09-25
why: External hosts must remove their published-dist history patch.
sources: [https://github.com/vanilla-wave/rifty/issues/355]
---

## Context

Issue #355 supplies the host scenario and explicitly permits rejecting incomplete tool calls.
No matching pending item found in docs/backlog; ADR-0436 deferred this capability.

## User scenario

A host stores native message_end AgentMessage[] and restores it into a fresh headless
session after reload or panel reopen, including a model change. The next send continues
that history without replaying tools. Reset clears it. Host owns storage and project reset.
Incomplete or malformed input fails before host/model work; paired host error results work.
Trace distinguishes restored messages from current run events, timings and usage;
per-run tool/time limits apply only to new runs. Caller mutations cannot change the seed.

## Acceptance

1. Public initialMessages accepts readonly native history; send continues it through both transports, including a new model; no tool replay. → scenario
2. reset clears seed; omitted history preserves fresh-session behavior; caller and session histories remain isolated. → scenario
3. exportTrace restoredMessageCount identifies its restored transcript prefix; events/timings/usage count only this session; reset clears provenance. → scenario
4. New runs each receive the configured tool/time budget independent of old calls/timestamps. → scenario
5. README documents restoration and narrows unsupported persistence to host-owned storage. → scenario

## Fault matrix

- Reload interrupts a tool call × create: TypeError naming initialMessages for missing result; no tool dispatch. → scenario
- Orphan/duplicate/mismatched tool result or malformed message envelope × create: TypeError before host/model work. → scenario
- Host supplies paired isError result × create/send: retain its native meaning, never replay. → scenario

## Out of scope

Storage adapters and Playground persistence remain host policy. Provider conversion remains Pi-owned.
No schema migration or arbitrary JSON decoder; callers supply native Pi 0.85.1 messages.

## Decisions

- 2026-09-25 — ADR-0466 adds native seed and trace prefix; issue permits rejection, avoiding invented tool outcomes.
- 2026-09-25 — issue model-change clause applies to fresh host sessions; Playground settings policy ADR-0427 unchanged.

## Challenge

Pending independent Contract+RED and RDY-6 written-result check.
