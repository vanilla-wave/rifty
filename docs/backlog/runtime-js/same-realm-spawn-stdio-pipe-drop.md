---
area: runtime-js
status: draft
title: Same-realm spawn ignores stdio 'pipe' — child exits 0 with EMPTY stdout, output leaks to parent console
created: 2026-08-26
why: worst failure shape — success with missing data; an agent/toolchain reading a child's stdout (linter, typechecker, codegen, test runner) silently concludes "no output" and proceeds; direct Fidelity violation (no silent stubs)
user_story: As a dev (or agent) running `spawn('node',['./lint.js'])` without COI and reading `child.stdout` to decide the next step, I want the child's output on the pipe like Node, but today the same-realm fallback closes with code 0 and an empty stdout — the output went to the parent realm's console instead.
epic: no-coi-sandbox-tier
sources: [docs/backlog/runtime-js/reference/no-coi-degradation-probes.md]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-exec.ts]
---

## Context

Probe (reference table): `spawn('node',['./file.js'])` where file prints `2` —
no-COI same-realm path: close=0, stdout `""`, the `2` appears in the parent
realm's console log; product COI path: close=0, stdout `"2"`. So
`stdio:'pipe'` is silently ignored by `spawnViaSameRealm`
(`child_process.ts` ~:366 fallback; guest console wiring in
`child_process-exec.ts`). Not a throw, not a warn — success with missing
data; undetectable by the caller. Sibling same-realm-boundary defect:
`same-realm-child-async-throw-ownership` (async throws escape to owner).
Node oracle (stdout rides the pipe) needs a parity case at pickup — the probe
only compared the two rifty worlds.

## Options or Next

- Wire guest stdout/stderr of the same-realm child into the ChildProcess pipe
  streams (the COI path already does).
- If truly unwirable in some path — loud NotImplementedError, never exit-0
  with empty pipe (Fidelity).

## Reversibility

REVERSIBLE — behavior fix behind existing `child_process.spawn` surface.
