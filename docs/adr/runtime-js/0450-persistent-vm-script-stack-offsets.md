# ADR 0450: Persistent VM script stack offsets

Status: Accepted
Date: 2026-09

> TL;DR: One stack dispatcher stays installed after VM scripts with offsets; encoded source URLs carry per-script coordinates for delayed errors.

## Context

Vitest evaluates a module with `vm.runInThisContext({ lineOffset, columnOffset })`, then runs exported test functions later. Node v24.16.0 reports `11:-13` for a delayed first-line error with offsets `10,-20`; Chromium's `eval` has no script-origin offset option. The accepted parity case also proves a multiline template literal must keep its bytes.

Candidates: source padding changes template literals and cannot make negative columns; a scoped `prepareStackTrace` hook ends before later test errors; browser source maps do not change programmatic `Error.stack`. Node 24.16.0 and Chromium 148 probes: `docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md`. A persistent dispatcher with offsets encoded in `sourceURL` reproduced the accepted stack coordinates without a script ledger.

## Decision

Extend the existing `source-maps.ts` dispatcher (ADR-0136), one owner of `Error.prepareStackTrace`. VM scripts encode filename and signed offsets in their source URL; the dispatcher maps only those frames, with `columnOffset` on physical line one. TS source-map entries remain scoped to factory evaluation. `Script` keeps constructor offsets; context-engine paths with offsets remain loud.

This partially supersedes ADR-0136's hook-lifetime choice: after the first offset VM script, the dispatcher remains for delayed stacks instead of restoring when TS mapping is idle. ADR-0136's scoped TS maps, decoder, invalidation and overlap behavior remain active.

## Consequences

- Delayed assertion stacks match Node without source edits, per-script tables or wrapper functions.
- One permanent hook affects stack preparation in this realm. An external replacement of `Error.prepareStackTrace` after VM evaluation can bypass VM remapping; custom structured CallSites are outside the claimed Vitest path and remain a documented gap.
- Verify same-filename/different-offset scripts and TS-map overlap as well as the exact Vitest Chromium path.
