---
area: perf
subsystem: runtime-js
status: draft
title: ADR-0082 — per-instance cached DataView for Buffer int/float accessors
created: 2026-06-08
why: every readUInt*/writeUInt* allocates a throwaway DataView; ~30 accessors; needs OOB parity cases; write-before-code
user_story: As a dev parsing binary in a hot loop, I want `buf.readUInt32LE` / `writeUInt32LE` to not stall on GC, but today each accessor does `new DataView` per call so tight loops thrash the allocator
sources: [perf-audit #13, adr-plan A/ADR-0082, ADR-0030 (downgraded, not superseded)]
---
## Context
buffer-prototype.ts:27 + all read/writeUInt*: `new DataView` per accessor. Governs internal accessor impls of cross-package Buffer (buffer-prototype.ts, buffer.ts). rule4 (~30 accessors + OOB parity cases) → NEW ADR.
## Options / Next
Lazily-cached full-range DataView keyed `WeakMap<Uint8Array,DataView>` inside buffer-prototype.ts — NO buffer.ts type-back import (check:arch). `dvFor(this).getUint32(off,le)`. Do NOT use byte-math fast path (returns garbage on OOB instead of RangeError, benchmarked slower). Preserve clone-survival; ADR notes clone-rebuild-on-receiver. Add OOB-throw parity cases (none exist for int accessors today).
## Reversibility
IRREVERSIBLE — rule4 (~30 accessors + OOB parity). Does NOT supersede ADR-0030 (brand/Symbol.species, not DataView strategy). No decision subagent.
