---
area: npm-client
status: draft
title: Shadow cache ledger freezes independent completion order
created: 2026-07-28
why: the recipe-v2 contract intermittently requires two distinct-key cache puts to finish in request order even though bounded acquisition runs them concurrently
user_story: As a contributor running pnpm pr:check, I want the shadow acquisition contract to assert only required event order, but today aggregate load can fail a green change when independent cache puts swap
sources: [PR-213, docs/process/fault-classes.md]
code:
  - packages/npm-client/src/shadow-recipe-v2-data-authority.contract.test.ts
---

## Context

During PR #213, the full npm-client suite passed 489/490 once because
`cache:put:napi-wasm@1.1.3` completed before
`cache:put:lightningcss-wasm@1.32.0`; `supportedFreshEvents()` requires the
reverse order. A later aggregate `pr:check` reproduced a test-lane failure,
while the exact case passed 40/40, its complete file passed 25/25, standalone
`test:run` passed 8,264 tests, and repeated full gates passed.

The installer awaits all acquisitions before linking, but distinct cache keys
run under bounded concurrency and each put follows asynchronous integrity work.
Their relative completion order is not a product contract; package placement
and later publication remain request-ordered. This is a `frozen-assumption` in
the test ledger, not an `observable-order` runtime defect. The sibling sweep
found the same exact cache-put ordering only in `supportedFreshEvents()` and
`supportedEddyEvents()` in this file.

Dedup searched backlog titles, `code:`, epic Items/children, ADRs, and cache
ledger/order terms. The existing bounded-concurrency perf draft owns acquisition
throughput, not this test defect. No serializer or product-order change is
justified merely to satisfy the ledger; a future ready contract must preserve
required phase edges while accepting physically independent completions.
