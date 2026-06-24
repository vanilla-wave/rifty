---
area: protocol
status: shipped
title: TS completion-resolve carries `source`/`data` for exact same-name auto-imports
created: 2026-06-22
why: ts:getCompletionDetails now keys exact resolves with `label` plus TS `source`/`data`, preserving label-only fallback for old callers
user_story: As an editor user, the resolved detail of the exact completion I selected is returned even when two auto-import candidates share the same label
sources: [ADR-0166]
code: [packages/ts-language-service/src/worker/protocol.ts, packages/ts-language-service/src/service.ts]
---

## Context

Landed 2026-06-22: completion items now carry the TypeScript entry `source` and
opaque `data`, and `ts:getCompletionDetails` echoes them back so same-name
auto-import candidates resolve exactly.

This shipped item is retained as the delivery record. `ts:getCompletions` returns
each entry's `source` and opaque structured-clone-safe `data`; completion resolve
echoes them to `getCompletionEntryDetails`, so same-name auto-import candidates
resolve to the exact selected entry. Older label-only callers still work by
re-querying the list and using the first matching name.

## Verification

- `parity.test.ts` checks completion metadata and auto-import resolve against real
  TS, including additional edits from completion code actions.

## Reversibility

REVERSIBLE — internal worker protocol, not a published API. Recorded here; the
editor consumes exact `source`/`data` resolve metadata, with label-only fallback
retained for older callers. No ADR (no public-API / ADR-contradiction).
