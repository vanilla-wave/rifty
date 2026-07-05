---
area: process-meta
status: draft
title: Fault tier — shared decorators, convention, migration
created: 2026-07-05
why: fault-classes.md defines the taxonomy; the executable part (injection decorators, test convention adoption, tagging existing de-facto fault tests) doesn't exist yet
user_story: As an implementer of an infra item, I want ready-made fault injectors for my Fault-matrix rows, but today every PR hand-rolls injection (vi.stubGlobal, ad-hoc wrappers) and de-facto fault tests are indistinguishable from unit tests
---

## Context

`docs/process/fault-classes.md` (axes + honest-outcome contract + `*.fault.test.ts` convention) landed with the process PR; missing:

- 3-4 shared per-boundary decorators: fetch (stall / 500 / truncated / slow-loris), OpfsFsSync fail-persist-by-predicate, store/bundle byte-corruptor. Per-boundary by decision — one shared framework rejected as over-engineering.
- tag/migrate existing de-facto fault tests (#107 added many: stall, corrupt store object, dirty ledger, hanging JSON body) into the convention so per-axis coverage is countable.
- optional gate: `backlog:check` (or lint) requiring `## Fault matrix` on `ready` items in infra areas.
