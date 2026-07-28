---
area: process-meta
status: ready
title: Pickup excludes executable test and fixture sources
created: 2026-07-28
why: Contract+RED tests currently move pickup before their judge-authored ready authority, so contract-drift and budget reject the documented autonomous slice sequence
sources: [PR #209, docs/backlog/README.md, tools/checks/run-pickup.mjs, tools/checks/budget.mjs]
code:
  - tools/checks/run-pickup.mjs
  - tools/checks/run-pickup.test.ts
  - tools/checks/budget.mjs
  - tools/checks/budget.test.ts
  - tools/checks/contract-drift.mjs
  - tools/checks/contract-drift.test.ts
---

## Context

`pickupCommit` calls every TypeScript path below `apps/`, `packages/`, or
`services/` production source. In PR #209, the exact Contract+RED commit adds
only `*.test.ts` files after a raw contract. The next commit records the clean
checkpoint and flips its item ready, as required by
`decision-workflow.md`. Pickup nevertheless becomes the parent of the RED
tests, so `check:contract-drift` rejects that ready authority and
`check:budget` cannot see the selected row.

`budget.mjs` already owns a partial test/fixture path classification for
mechanism scanning. It misses the repository's `_test-fixtures/`,
`test-fixtures/`, `test-*`, and `*-test-fixture` support forms. Pickup,
budget mass, mechanism scanning, and contract drift need one complete
tri-state path classification before any consumer projection. The adjacent
`process-meta/contract-drift-comment-relink-false-positive` item is not a
duplicate: it needs hunk-level comment classification; this item is the
strict path-level test/fixture case.

## User scenario

During an autonomous goal slice, an agent commits executable Contract+RED
tests, receives a clean checkpoint, records the ready authority, then commits
production source. `check:contract-drift` and `check:budget` must select the
ready-authority commit as pickup and validate the source delta after it.

## Acceptance

- One shared classifier returns `production` for ordinary
  `apps|packages|services` `.ts|tsx|js|jsx|mjs|cjs` files, `test-support` for
  these forms anywhere, and `other` otherwise: dotted
  `.test|spec|test-fixture|contract-fixtures` suffixes; directory segments
  `test|tests|__tests__|fixtures|_test-fixtures|test-fixtures`; basenames
  `test-*` and `*-test-fixture`.
- Pickup, contract drift, and mechanism scanning select only `production`.
  Budget mass excludes only `test-support`, so ordinary hand-written docs,
  configs, and tool source remain counted.
- `pickupCommit` ignores Contract+RED test/fixture commits and returns the
  parent of the first real production-source commit.
- Hand-written budget mass excludes the same tests and fixtures, matching
  `docs/backlog/README.md`.
- The PR #209 sequence — RED tests, ready authority, implementation — selects
  the ready-authority commit, so its JIT item/Budget row are visible and not
  classified as post-pickup drift.
- Existing production-source, process-only, and synthetic-main-merge cases
  remain green.

## Parity cases

Repository policy in `docs/backlog/README.md` is the oracle:

1. Every `apps|packages|services` × `.ts|tsx|js|jsx|mjs|cjs` ordinary source
   path is `production`.
2. `*.test.*`, `*.spec.*`, `*.test-fixture.*`, and
   `*.contract-fixtures.*` are test sources.
3. Files below `test/`, `tests/`, `__tests__/`, `fixtures/`,
   `_test-fixtures/`, or `test-fixtures/` are test sources.
4. `test-*` and `*-test-fixture` JavaScript/TypeScript basenames are test
   support. This includes the current
   `test-monaco-editor.ts`, `test-workspace-typescript.ts`,
   `fd-test-fixture.ts`, and `path-test-fixture.ts` witnesses.
5. Ordinary docs, `tools/`, binaries, and generated non-source paths are
   `other`: they do not start pickup but remain budget mass unless an existing
   generated/binary rule excludes them.
6. Test-support forms outside the production envelope, including
   `tools/checks/*.test.ts` and root `tests/**`, remain `test-support` and do
   not contribute budget mass.
7. A test-only commit followed by ready authority and production source picks
   the authority commit; replacing the final source with another test keeps
   merge-base pickup.

## Fault matrix

| Boundary / axis | Required outcome | Fault target |
|---|---|---|
| Git path/history → production claim / `provenance-lie` | every ordinary root × extension path starts pickup; every settled test-support form does not; test-only history keeps merge-base | table-driven `pickupCommit` matrices, test-only-final branch, temp-git RED → ready/JIT → source sequence |
| Classifier consumers / `sibling-drift` | one exported tri-state chokepoint feeds the production-only pickup/drift/mechanism projection and test-support-only budget exclusion | consumer tables plus actual `contract-drift.mjs` and `budget.mjs` temp-git run |
| Internal convention / `frozen-assumption` | exact forms come from committed repository witnesses, not a self-invented wildcard | named witness paths plus positive ordinary-source counterexamples |

Network, storage, cache, worker, concurrency, quota, and torn-write axes are
physically excluded: this gate reads local Git output and performs a
deterministic path projection. The change adds one classifier chokepoint and
no coordination mechanism or mutable owner.

## Out of scope

- Comment-only TODO relink classification remains
  `process-meta/contract-drift-comment-relink-false-positive`.
- Generated-file budget globs and production directory layout are unchanged.
- Test-support names outside the exact settled forms above remain
  `production` inside the envelope and `other` outside it until separately
  evidenced; content and imports never affect the classifier.
- No file inside the production envelope may evade pickup merely because its
  contents look like a test; classification is path-only.

## Decisions

ready-verdict: 2026-07-28 — Exact repository witnesses and roots×extensions/near-miss matrices settle the tri-state path contract; production-only pickup/drift/mechanism projections and test-support-only budget exclusion—including tools/root tests while ordinary other mass remains counted—settle every consumer; test-only history plus the temp-Git PR #209 run through contract-drift and budget settle acceptance, fault rows, and executable REDs; overlap, physical exclusions, and the no-mechanism inventory are clean.

- Reuse one exported `production | test-support | other` classifier.
  Pickup, contract drift, and mechanism scanning compare with `production`;
  budget mass excludes only `test-support`. Do not add another allowlist.
- Exclusion is exact to the enumerated forms. `_test-fixtures/tar-builder.ts`
  and `test-fixtures/durable-owner-fs.ts` settle the two directory spellings;
  the four named basename witnesses settle the prefix/hyphen forms.
- RED evidence comprises the pickup path/history matrices, budget
  mass/mechanism tables, contract-drift consumer table, and one temp-git
  PR #209 composition through both executable gates.
