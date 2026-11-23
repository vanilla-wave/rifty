---
area: distribution
status: draft
title: Should SDK install rejections carry installer structured fields (reason, packageName) to the host?
created: 2026-11-23
why: A host that must branch on an install failure (e.g. the cold-cache shadow-pin refusal, `reason: 'shadow-replay-cache-miss'`) gets only `name`/`message`/`code`; parsing message text is its only route.
user_story: As an embedder calling `toolchain.install`, I want to tell a cold-cache substituted-pin refusal from a broken lock without matching the message text.
sources: [PR-426, docs/adr/distribution/0547-frozen-prepared-dependency-snapshots.md, packages/runtime-js/src/protocol.ts, packages/workbench/src/workers/no-coi-project-command.ts]
code:
  - packages/runtime-js/src/protocol.ts
  - packages/runtime-js/src/worker-fs-rpc.ts
  - packages/workbench/src/workers/no-coi-project-command.ts
  - packages/npm-client/src/internal/shadow/substitution.ts
---

## Context

Observed 2026-11-23 (PR #426 cross-review round 2): npm-client errors carry
`code`, `packageName` and `reason` (e.g. `EBROKENLOCK` with `reason:
'shadow-replay-cache-miss'` or `'shadow-trace-drift'`). The SDK transport
`SerializedRuntimeError` (`packages/runtime-js/src/protocol.ts:67`) keeps only
`name`, `message`, `stack`, `code`, `path`, `feature`, `cause`, `effects`; the
toolchain Worker serializers (`serializeError` in
`no-coi-project-command.ts`, the owner's result path) copy the same subset.
So a `toolchain.install` rejection reaches the host with `code: 'EBROKENLOCK'`
and no `reason`/`packageName`; every `EBROKENLOCK` cause looks alike except by
text. Present on BASE too (`23ed6b44556c`), not introduced by PR #426.

No match in backlog titles/`code:` or `docs/adr/README.md` §Declined concepts
(searched `SerializedRuntimeError`, `serializ`, `reason`, `packageName`); the
neighbouring `playground/structured-execution-diagnostics` covers page/PTY
diagnostics, not the SDK install rejection.

## Question

1. Should the SDK install rejection expose installer structured fields (which
   ones, under which names), making them public API (ADR, `DEC-1`), or stay
   `code` + message only? Agent-owned once a host scenario needs it; adding
   public fields is an ADR.

Owner: distribution. Trigger: a host scenario that branches on an install
failure cause, or a support report of text-matching on `EBROKENLOCK`.
