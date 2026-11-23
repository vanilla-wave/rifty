---
area: distribution
status: ready
title: Move the agent stack from pi 0.85.1 to pi 1.6.0 with CLI-faithful behavior
created: 2026-11-23
why: user asked to update pi-ai to latest; pi packages are co-versioned and pinned together
user_story: As an embedder of @riftydev/agent, I want the latest pi behavior in the browser agent, but today it is pinned to pi 0.85.1 and pi 1.x removed the utilities it uses
blocked_by: []
sources: [ADR-0424, ADR-0472, ADR-0473, ADR-0569, ADR-0570, docs/backlog/distribution/reference/pi-0.85.1-typebox-tool-probe.json]
code: [packages/agent/src/session.ts, packages/agent/src/continuation.ts, packages/agent/src/pi-cli/compaction.ts, packages/agent/src/pi-cli/messages.ts, packages/agent/src/pi-cli/skills.ts, packages/agent/src/history.ts, packages/agent/src/prompt.ts, packages/agent/package.json]
---

## Context

User request: update `@earendil-works/pi-ai` to latest, design, implement, run
evals. Latest on 2026-11-23: pi-ai, pi-agent-core, pi-coding-agent 1.6.0. Manager
default (not the user's words): move the whole co-pinned stack; ADR-0569/0570
record two forks taken on the manager's default, user confirmation pending.

Pi 1.x facts (probes in ADR-0569/0570 and the PR body): agent-core harness removed
(1.0.0); `Type` not exported (pi-ai 1.x); prompt and tools are `system` messages,
`state.systemPrompt` getter-only (TypeError on assignment); abort-skipped calls get
"Operation aborted" results (1.6.0); CLI compaction drops summary `maxTokens`,
rewrites the turn-prefix prompt, omits thinking, persists recovery omissions and
recovers length stops.

## Challenge

challenge: 2026-11-23 — clear: the latest pin is the user's explicit request; the rival "pin 0.99.2" route is recorded in ADR-0569 §Alternatives

## User scenario

An embedder runs `createAgentSession` (Workbench COI, no-COI packed consumer,
custom `streamFn`) on pi 1.6.0: tools, Stop, retry, overflow/threshold compaction,
restore from `initialMessages` and archive behave as the real pi CLI 1.6.0 does for
the same provider responses; `Type.Object` tools keep the 0.85.1 contract; the
agent-bench core-v1 series shows no lost passes attributable to the upgrade.

## Acceptance

1. Continuation, retry, overflow, recoverable length and threshold compaction equal the real CLI 1.6.0 `AgentSession` on 13 scripted scenarios (requests, retries, compaction numbers, transcript incl. system positions). `tools/agent-bench/src/continuation-parity.test.ts` → ADR-0569
2. A `Type.Object` consumer tool reaches the wire as on pi 0.85.1 (minus pi 1.x `strict: false`) and accepts/rejects/coerces 8 argument cases exactly as the captured 0.85.1 probe. `packages/agent/src/typebox-tools.test.ts` → ADR-0570
3. Stop mid-batch in Chromium: the skipped call gets an error result, no side effect, next run continues. `tests/browser-unit/agent-core.spec.ts` → ADR-0424
4. The shared prompt recipe reaches the CLI 1.6.0 wire as the current system message; skills and `project_context` blocks are byte-identical to CLI 1.6.0. `prompt-recipe-parity.test.ts`, `project-resources.test.ts` → ADR-0440
5. Histories with pi 1.x `system` messages (events, trace, archive) restore through `initialMessages`, including a summary after prompt state. `history.test.ts`, `continuation.fault.test.ts`, browser `agent-core.spec.ts` → ADR-0466
6. Packed consumer installs, typechecks and builds with pi 1.6.0 tarballs; client bundle budgets hold. `pnpm test:client-bundles` → ADR-0436
7. core-v1 eval series on 1.6.0 vs a fresh 0.85.1 baseline on the same endpoint/limits; every FAIL classified per `tools/agent-bench/README.md`. Summary in `tools/agent-bench/reports/summaries/` → ADR-0472

## Out of scope

- native-codex lane (pi-independent).
- pi CLI features rifty never reaches: extension hooks, branch summaries, codemode nested calls, per-model compaction overrides, cache warming.

## Decisions

- 2026-11-23 — manager default: port CLI compaction (ADR-0569) and keep `Type` via direct `typebox` (ADR-0570); user confirmation pending before merge.
- 2026-11-23 — transcripts keep pi 1.x `system` messages (native history) instead of filtering them; restore admits them.
