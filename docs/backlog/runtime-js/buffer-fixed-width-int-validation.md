---
area: runtime-js
status: draft
title: Buffer fixed-width int accessors lack Node range/bounds validation
created: 2026-06-21
why: the variable-width accessors now throw ERR_OUT_OF_RANGE / ERR_BUFFER_OUT_OF_BOUNDS (Node-faithful), but the fixed-width family (readUInt8…/writeUInt8…) still silently truncates an out-of-range value and throws a bare DataView RangeError on OOB — a pre-existing silent divergence the var-width fix made inconsistent.
user_story: As a developer, I want `buf.writeUInt8(256, 0)` to throw `ERR_OUT_OF_RANGE` and `buf.readUInt32LE(oob)` to throw `ERR_BUFFER_OUT_OF_BOUNDS` exactly as Node does, but today the fixed-width accessors `setUint8(offset, value)` modulo-truncate the value and surface a bare `RangeError` (no `.code`) on OOB.
sources: [PR #62 review, var-width fix in buffer-prototype.ts]
code: [packages/io/src/buffer-prototype.ts]
---

## Context

`installIntMethods` fixed-width readers/writers go straight through `dvFor(this).getX/setX`.
DataView `setUint8`/`setUint16`/… do NOT range-check the value (silent `& 0xff` / modulo), and
throw a generic `RangeError: Offset is outside the bounds of the DataView` (no `ERR_BUFFER_OUT_OF_BOUNDS`
code) on OOB. Node validates both: value range → `ERR_OUT_OF_RANGE`, offset → `ERR_OUT_OF_RANGE`/
`ERR_BUFFER_OUT_OF_BOUNDS`. The variable-width accessors were fixed in PR #62 (same `oor`/`checkValue`/
`checkOffset` helpers); the fixed-width family was left as-is to keep that PR scoped — but it is the same
defect class and now reads inconsistently next to the validated var-width methods.

## Options or Next

Parity-first. Add a failing parity case (real Node oracle) covering each fixed-width read/write OOB +
out-of-range value, then thread the same range/bounds validation (factor the var-width `oor`/`checkValue`/
`checkOffset` helpers to module scope and reuse) through every fixed-width accessor. Watch the hot-path
perf note on `dvFor` — Node validates on every call too, so the cost is Node-faithful.

## Reversibility

REVERSIBLE — recorded in this backlog item. Behavior-narrowing (rejects what was silently accepted);
no public-API or dep change.
