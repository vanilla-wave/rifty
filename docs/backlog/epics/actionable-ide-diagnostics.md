---
kind: epic
status: draft
title: Actionable IDE diagnostics
created: 2026-07-09
value: Install, runtime, compatibility, TypeScript, and preview failures remain visible until resolved and lead the user to the exact run, file, or recovery action.
user_story: As a developer whose project did not run, I want one retained explanation with source and recovery actions, but today TS owns Problems while other failures disappear into a toast, terminal scrollback, or browser console.
items: [playground/diagnostics-hub, playground/structured-execution-diagnostics, playground/compatibility-diagnostics-adapter, playground/preview-diagnostics-adapter]
---

## Outcome

Problems becomes a source-aware project/run truth surface without replacing raw stdout/stderr or real upstream responses. Every record carries provenance and lifecycle; absent evidence yields partial/unknown copy, never `No problems detected` for an unscanned project.

## User scenario

A real npm project fails during install, then a later preview request loses its owner and receives the broker's fault-honest synthetic 503 while an open file has a TypeScript error. The hub retains three distinct records, jumps to the exact terminal command block or editor span, preserves the preview fault provenance, offers only valid Retry/Open/Copy actions, and clears each record when its authoritative source reports recovery. A real upstream 403 remains an application response, not an IDE problem.

## Items

- `playground/diagnostics-hub` — app-internal record model, lifecycle, filters, counts, and actions.
- `playground/structured-execution-diagnostics` — owner/run/install outcomes without terminal parsing.
- `playground/compatibility-diagnostics-adapter` — explicit mapping and lifecycle for predicted/observed compatibility facts.
- `playground/preview-diagnostics-adapter` — preview failures retain real transport provenance and recovery.

## Draft gates

Compatibility facts are consumed from `honest-compatibility-in-the-ide`, not redefined here; this epic owns only their mapping into retained records. Preview fault semantics remain owned by `fault-honest-sw-preview`. Any new owner wire shape needs an ADR before the affected item becomes `ready`.
