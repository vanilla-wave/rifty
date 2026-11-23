---
area: distribution
status: draft
title: Isolate host — an unhandled rejection's report is built from isolated-vm's copy of the reason
created: 2026-11-22
why: "Ordinary agent code (`e.code = 'E_X'; Promise.reject(e)`, an `fs.promises` ENOENT, a subclass) loses props, `[cause]` and class name in the fatal report; Node prints them"
sources: [docs/public/compat/isolate-host.md, docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md]
code: [packages/isolate-host/src/child/main.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

Found by PR #421 external review round 2, located 2026-11-22 (read-only
trace, isolated-vm 7.0.2 unpatched): one point.
`src/isolate/environment.cc:500` `TaskEpilogue` hands the rejected promise's
result to `ExternalCopy::CopyThrownValue` (`src/external_copy/external_copy.cc:237-291`),
which keeps only the class family (Error/Range/Reference/Syntax/TypeError,
else CustomError with an inherited `name`), `message` and `stack`;
`CopyInto` (`:331-364`) rebuilds a plain `Exception::Error`. The host's
`onUnhandledRejection` (`child/main.ts:144`) then copies that into the guest
(`:146`), `entry.ts:293` → `handleRealmUnhandledRejection` → `fatalReportText`.
A synchronous throw never crosses the boundary and keeps everything. No guest
JS hook exists for an unhandled rejection in a bare V8 context, so the fix is
native: hand the guest a reference to the original reason (ReferenceHandle on
`promise->Result()`) instead of a copy, `derefInto()` on the host side — a
patched native dependency (IRREVERSIBLE: ADR + guest-package adaptations
inventory row). Rows `rejection-with-props-cause-subclass`,
`rejection-fs-enoent` (`node-file-pins.json` isolate) move to `node` then.
The `UNCOPYABLE_REJECTION` branch (`child/main.ts:149`, `entry.ts:296`) looks
unreachable (`CopyThrownValue` does not throw) — recheck with the fix.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
