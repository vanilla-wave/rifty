---
area: protocol
status: parked
title: TS completion-resolve carries only `label` (same-name auto-import ambiguity)
created: 2026-06-22
why: ts:getCompletionDetails frame keys on `label`; two same-named auto-import candidates can't be disambiguated
user_story: As an editor user, I want the resolved detail of the EXACT completion I selected, but today two same-named auto-import candidates (e.g. two `Button` from different modules) resolve to whichever the engine lists first — the wrong import path may be shown
sources: [ADR-0166]
code: [packages/ts-language-service/src/worker/protocol.ts, packages/ts-language-service/src/service.ts]
---

## Context

`ts.getCompletionEntryDetails(file, pos, name, fmt, source, prefs, data)` needs the
entry's `source` + opaque `data` to disambiguate same-named candidates (the classic
case: two auto-import `Button`s from different modules). The `ts:getCompletionDetails`
protocol frame carries only `{path, position, label}`.

Current mitigation (correct for everything EXCEPT same-name collisions): the service
re-queries `getCompletionsAtPosition` and looks the entry up by `name`, threading its
real `source`/`data` into `getCompletionEntryDetails`. So ordinary members/locals/
globals AND a *uniquely*-named auto-import resolve exactly. The ONLY residual gap:
when two entries share a `name`, `find(e => e.name === label)` picks the first — the
detail (and its import-path text) may be for the wrong candidate. Not a lie (it IS a
real candidate's detail), but possibly not the one the user highlighted.

## Options or Next

- A. Carry the opaque entry `data` (+ `source`) on `ts:getCompletion(s)` entries and
  echo it back in `ts:getCompletionDetails` — exact disambiguation, no list recompute.
  Cost: widen the wire shape; `data` is `unknown` in the TS protocol (structured-clone
  safe today, but unstable across TS versions).
- B. Keep label-only resolve; accept first-match for same-name collisions (today).
- Next: when the playground editor wires completion resolve, measure whether same-name
  collisions actually surface in real fixtures before widening the protocol (A).

## Reversibility

REVERSIBLE — internal worker protocol, not a published API. Recorded here; pick A vs B
when the editor consumes resolve. No ADR (no public-API / ADR-contradiction).
