---
area: opencode
status: active
title: Fold .d.ts-exclusion into ADR-0053 via a superseding ADR/amendment
created: 2026-06-08
why: ratified-immutable ADR-0053 doesn't record the declaration-file exclusion its contract now relies on
sources: [docs/opencode/feature-02-ts-on-import-graph.md §Risks (F02-DTS-EXCLUDE), ADR-0053, audit-digest]
---
## Context
F02-T1 added `.ts`/`.tsx` to `DEFAULT_EXTENSIONS`/`INDEX_FILES` with NO declaration-file exclusion, so a target shipping only `.d.ts` resolved it (relative `./foo.d`→`foo.d.ts`; explicit `./foo.d.ts`; a package whose `exports`/`main` names a `.d.ts`) — strip-types then fed types-only source to acorn → `SYNTAX_ERROR`. Node's strip-types loaders skip `.d.ts`. The resolver now rejects any `*.d.ts`/`.d.cts`/`.d.mts` candidate at every file-acceptance point (resolves as absent → MODULE_NOT_FOUND), surgically (a runnable sibling `foo.js` still wins); pinned by `tests/conformance/modules/resolver.test.ts describe('declaration-file exclusion')`. The fix shipped and is tested; the GAP is documentation: ADR-0053 (ratified, immutable) does NOT record this exclusion in its Deviation section, though its contract now relies on it.
## Options / Next
ADRs are immutable after merge → amending ADR-0053 in place is out of scope. Next: write a SUPERSEDING ADR (or an amendment note) that folds the `.d.ts`/`.d.cts`/`.d.mts`-exclusion into ADR-0053's resolver-extension contract, citing ADR-0053. Behavior + tests already exist; this is purely making the recorded decision honest/auditable.
## Reversibility
IRREVERSIBLE doc step: updating an already-recorded immutable ADR → produce a new superseding ADR (per ADR-0063 reconsideration-of-a-recorded-decision). No code change; no behavioral fork.
