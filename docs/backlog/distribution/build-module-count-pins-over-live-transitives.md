---
area: distribution
status: draft
title: The no-COI build-parity and child-fs lanes pin `✓ 2180 modules transformed` over transitive versions resolved live, and now read 2990
created: 2026-10-16
why: two default browser lanes fail on main `aebdd7ddd` with no product change — the pinned module count is a frozen assumption over live registry resolution of transitive dependencies
user_story: As a developer running the default no-COI and browser-unit lanes, I want them red only on a rifty regression, but today `no-coi-sandbox-build-loop` "build parity … designed RED" and `child-fs-in-realm-lane` fail on main with `2990 modules transformed, expected 2180`
sources: [tests/no-coi/no-coi-sandbox-build-loop.spec.ts, tests/browser-unit/child-fs-in-realm-lane.spec.ts]
code: [tests/no-coi/no-coi-sandbox-build-loop.spec.ts, tests/browser-unit/child-fs-in-realm-lane.spec.ts, tests/browser-unit/fixtures/child-fs-in-realm-worker.ts]
---

## Context

Finding (2026-10-16, while running the Vite lanes of
`npm-client/vite-cli-action-keepalive-hook-removal`). On a clean worktree at
`aebdd7ddd` (before any change of that unit), Chromium via Playwright:

- `tests/no-coi/no-coi-sandbox-build-loop.spec.ts:2343` "build parity: headerless
  SDK dist equals live COI product bytes — designed RED": `:668`
  `expect(moduleTransformLines(build.out)).toEqual(['✓ 2180 modules transformed.'])`
  receives `✓ 2990 modules transformed.`;
- `tests/browser-unit/child-fs-in-realm-lane.spec.ts:9`: `in-realm child fs scenario
  transformed 2990 modules, expected 2180` (`:222`).

Both install the canonical scenario's top-level dependencies (exact versions
asserted, `:658-662`) through the registry route; transitive versions resolve
live, so the transformed-module count moved without a rifty change. Same result
on the unit's branch — not caused by it.

Dedup: no backlog item names the module-count pin; evidence docs
`distribution/reference/no-coi-sandbox-build-loop-evidence.md` and
`no-coi-build-spike-record.md` record 2180 as the observed value at their time.

## Challenge

<!-- finding capture — no premise critic at draft (README §Challenge) -->
