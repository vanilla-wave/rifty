---
area: runtime-js
status: draft
title: "A fatal report reaches the process's stderr whatever the guest did to `process.stderr`"
created: 2026-11-18
why: Node's ReportFatalException writes fd 2; rifty's fatal and listener-throw prints call the guest-patchable `process.stderr.write`, `process.stderr` is a writable field (Node: getter only), and a non-writable guest `write` poisons the reused no-COI realm
sources: [docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/process-lifecycle-events.ts, packages/workbench/src/workers/no-coi-project-command.ts]
---

## Context

PR #406 outside findings 7 and 11. Node v24.16.0, probe 2026-11-18, each `node -e`
then `throw new Error('boom')`:

- `process.stderr.write = () => true` → full report, status 1;
- `process.stderr = { write() { return true } }` → assignment ignored (the
  property is getter-only; in strict code, e.g. an ES module, it throws
  `TypeError: Cannot set property stderr of #<process> which has only a getter`),
  full report;
- `Object.defineProperty(process.stderr, 'write', { value() { throw … }, writable: false })`
  → full report, status 1.

Rifty at `294673988`:

- No-COI project command sync throw: the host re-installs its writer before
  `terminateFatal` (PR #406, `no-coi-fatal-stderr` carriers
  `fatal-silenced-stderr` / `fatal-throwing-stderr` pass).
- Still through the guest's `write` (code read, both hosts): a program entry's
  realm-trap fatal rejection (`terminateFatal` from `event-loop-keepalive.ts`)
  and the status-7 listener-throw print (`NodeProcessExit.listenerThrew`), via
  `writeStderr: (text) => this.stderr.write(text)` (`process.ts`). A `-e`
  rejection after evaluation is claimed first by `beginNodeEvalUnhandled`; its
  eval terminal writes through the writer captured before guest code
  (`captureNodeEvalTerminalProcess`, Greptile on PR #407, code read).
- `process.stderr` is a writable class field: a reassigned object captures the
  trap and status-7 prints (code read). The command's sync path still reports,
  since the re-install writes onto that object (RDY-6 reviewer probe, scratch);
  the invocation's `finally` restores only `.write`, so the reused realm keeps
  the guest object as `process.stderr` (code read, later command not run).
- A non-writable guest `write` defeats the re-install (`Reflect.set` false); the
  invocation's `finally` restore then throws, and every later command in the
  reused realm prints `node: Cannot assign to read only property 'write'…`
  (Final+GREEN reviewer probe at `4ce4a10ee`, scratch; BASE identical).

Dedup (main + open PRs #384/#388/#394/#398/#405, 2026-11-18): no item owns the
fatal sink. Fault: `provenance-lie` / builtin → guest patch boundary
(`rules/fault-classes.md`). Compat ⚠️ `process.md` "Fatal error stderr bytes".

## Question

Which sink does the report use — a capture of the process's own writer at
construction (the kernel stdio port; for the shared no-COI process the host's
per-invocation redirect), or an accessor-shaped `process.stderr` as Node's?
