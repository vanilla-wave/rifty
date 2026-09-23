---
area: runtime-js
status: draft
title: Node children execute required startup options before their entry
created: 2026-09-23
why: Vitest 4.1.11 passes the same startup flags to both pools; Worker rejects them, while fork silently drops their argv, preload, conditions and resolver behavior.
epic: vitest-run-in-browser
sources: [docs/backlog/epics/vitest-run-in-browser/goal.md, docs/backlog/runtime-js/worker-threads-inherited-exec-argv.md, docs/backlog/runtime-js/node-cli-preload-import-flags.md, docs/backlog/runtime-js/reference/worker-thread-exec-argv-evidence.md, ADR-0267, ADR-0339, ADR-0456]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/node-entry-runtime-config.ts, packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/module-loader/resolver-profile.ts, packages/runtime-js/src/module-loader/esm-job-evaluation.ts, packages/workbench/src/workers/node-entry-bootstrap.ts]
---

## User scenario

A real file Worker or fork receives Node startup options. Before entry, its own
realm runs CJS preloads through its loader, activates package conditions and the
optional parentURL argument of import.meta.resolve. It reports exact public
execArgv; recursive Workers inherit the trusted launch unless explicitly
replaced; fork defaults read current public process.execArgv, as Node does.
This is the shared startup boundary used by both accepted pools.

Supported spellings in this unit: `--require <specifier>`, repeated
`--conditions <condition>`, `--experimental-import-meta-resolve`. Values are
arbitrary module specifiers/condition strings, never Vitest names. Other
spellings/options retain a named unsupported ceiling; no option is discarded.

## Challenge

challenge: 2026-09-23 — accepted I4/I5/I6 premise reused; exact installed native
Vitest census proves the flags are material defaults, not an optional config.
Skipping flags or injecting Vitest's preload would change runtime behavior.
Fresh independent Contract+RED remains pending; no implementation authorized by
this draft alone.

## Reference contract

Node v24.16.0; exact Vitest 4.1.11 / Vite 8.0.16. Native and physical fixtures
share source; Chromium runs through sealed Workbench with real isolated
Workers. Evidence includes the native option vector, semantic outputs and RED.

## Acceptance

1. An explicit supported execArgv vector is snapshotted at Worker construction,
   delivered exactly to process.execArgv, and cannot change through caller-array
   mutation. The parent realm remains untouched. → I5, I6, scenario
2. CJS preloads execute in argv order before entry, in the child's loader/cache
   and process realm. For Worker, a missing/throwing preload blocks entry and emits the
   native Worker error followed by exit 1. → I5, I6, scenario
3. Repeated conditions augment Node's default condition set for require,
   static import and dynamic import; package declaration order remains the
   selector. Conditions are not inferred from public argv mutations. → I5, I6, scenario
4. With the flag, import.meta.resolve(specifier,parentURL) resolves relative to
   that parent; without it, the second argument is ignored. Existing builtin
   resolution remains faithful. → I5, I6, scenario
5. A recursive Worker inherits the original supported launch options despite
   public process.execArgv mutation. Explicit [] resets argv, preloads,
   conditions and the experimental resolver flag. → I5, scenario, ADR-0267
6. Missing operands for the supported --require/--conditions spellings throw
   native ERR_WORKER_INVALID_EXEC_ARGV synchronously, before entry. A following
   valid Worker still runs. Unsupported flag families stay named ceilings. → scenario
7. fork applies the same supported explicit options and explicit [] reset.
   An omitted override snapshots current public process.execArgv; this differs
   from Worker's trusted inheritance. Later caller-array mutation cannot alter
   the admitted fork launch. → I4, I6, scenario
8. The exact unchanged Vitest pass/fail scenario produces the same reporter
   counts and exit codes as native Node for both pools. → I4, I5, I6

## Parity cases

Shared source: tests/browser-unit/fixtures/worker-startup-options-cases.ts.
Real browser: tests/browser-unit/worker-thread-startup-options.spec.ts.
Physical Node adapter: tools/node-parity-runner/cases/worker_threads/startup-*.
Fork carrier: tests/browser-unit/fixtures/fork-startup-options-case.ts,
tests/browser-unit/fork-startup-options.spec.ts and
tools/node-parity-runner/cases/child_process/startup-options.case.ts.

1. effective-options: exact argv, input-array mutation, ordered preloads,
   shared CJS cache, require/static/dynamic conditions, flag-on/off parentURL,
   builtin control, parent isolation. → I5, I6, scenario
2. trusted-recursive-inheritance: inherited original vector versus explicit
   [] after public-array mutation; the full semantic snapshot is compared. → I5, scenario
3. preload-missing / preload-throwing: no entry, native error then exit 1. → I5, I6, scenario
4. malformed-options: browser missing-operand rows plus a subsequent valid
   physical Worker. → scenario
5. fork startup-options: actual same-family argv/preload/require+import/
   parentURL behavior; explicit [] control and public-default/caller snapshot. → I4, I6, scenario
6. Existing real Vitest browser acceptance: unchanged exact package pair,
   TypeScript config/tests, both outcomes and both pools. → I5, I6

## Fault matrix

| axis × operation | honest outcome | carrier | trace |
|---|---|---|---|
| provenance-lie × raw startup identity | frozen trusted vector; public/caller writes cannot change launch | effective-options / trusted-recursive-inheritance | → scenario, ADR-0267 |
| observable-order × preload and entry | ordered same-realm preloads; failure blocks entry | effective-options / preload-missing / preload-throwing | → scenario |
| sibling-drift × resolver consumers | require/static/dynamic share active condition membership | effective-options | → I6, scenario |
| corrupt-input × supported option parse | native operand error before allocation; later valid launch works | malformed-options | → scenario |
| sibling-drift × recursive launch | Worker trusted inheritance; fork public default; explicit [] removes effects | trusted-recursive-inheritance / fork startup-options | → scenario |
| sibling-drift × Worker/fork dispatch | both execute the same compiled startup policy | effective-options / fork startup-options | → I4, I5, I6 |

Boundary: owned in-process startup policy projected into one ordered Worker
bootstrap. No loss, duplicate or reorder injection: MessagePort transports the
validated envelope atomically. Peer death/termination remain the existing
Worker lifecycle owner, not a new startup acknowledgement or retry mechanism.

## Out of scope

Broader source-bearing eval execArgv inheritance stays in
worker-threads-inherited-exec-argv. CLI -r/--require/--import contexts remain in
node-cli-preload-import-flags. This unit does not relax either named ceiling.
Worker eval/data entries, arbitrary flags and malformed fork flag vectors are
not claimed. Fork appends modulePath after execArgv, so its operand boundary
differs from Worker's validated standalone vector; do not reuse Worker usage
errors for it. The executed
fork sibling failure is required in this unit; it is not deferred to the CLI
preload residual.

## Decisions

- re-cut: 2026-09-23 — required supported-Worker-startup subset of worker-threads-inherited-exec-argv enters this goal; broader draft obligations preserved — trace: none
- 2026-09-23 — proposed ADR-0456 extends the exact worker-thread launch to v6; program adds the same raw startup vector; eval role semantics remain unchanged; no environment channel or second handshake.
- re-cut: 2026-09-23 — include executed fork sibling loss under one startup owner; preserve distinct native inheritance authorities — trace: none
- 2026-09-23 — status stays draft pending fresh independent Contract+RED; product code unchanged by this preparation.
