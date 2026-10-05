# ADR-0493: Host vm script offsets in shared stack mapping

- Status: accepted
- Date: 2026-10-01

## Context

Native Node v24.16.0: columnOffset applies only to first physical line; negative
columns are valid. `vm-script-offsets.case.ts` covers first/second line, negative
and positive offsets, Script and returned functions sharing a filename.
Baseline RED: vm.runInThisContext.lineOffset.

## Decision

Use the existing stack dispatcher. A unique sourceURL maps each host evaluation
to filename and offsets; returned functions retain their own evaluation identity.
Script retains constructor offsets. Sandbox engines keep their loud offset ceilings.

## Alternatives

- Prefix whitespace: rejected; cannot represent negative offsets, changes source semantics.
- Filename-keyed mapping: rejected by returned functions sharing filename/different offsets.
- Per-evaluation identity in shared stack dispatcher: chosen; no second stack hook.

## Proof

Native differential vm-script-offsets suite and real Vitest module evaluation.
