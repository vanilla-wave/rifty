---
area: process-meta
status: active
title: Scope Playwright CI serialization to heavy TS-LS specs
created: 2026-06-26
why: global CI worker count serializes the full e2e suite although the contention is limited to heavy TS-LS/fullstack specs.
user_story: As a CI maintainer, I want fast e2e feedback without TS-LS worker contention, but today every CI Playwright spec is serialized.
sources: [PR76 review C6]
code: [playwright.config.ts, tests/e2e]
---

## Context

`playwright.config.ts` sets `workers: process.env.CI ? 1 : undefined`, serializing the whole e2e suite in CI. The motivating contention is TS-LS/fullstack cold boot and large bundle fetches; unrelated isolated browser-context specs do not need the same global cap.

## Options or Next

Scope serialization to the heavy specs or split Playwright projects so TS-LS/fullstack tests run with constrained workers while independent specs keep parallelism. Keep local behavior unchanged.

## Reversibility

REVERSIBLE — CI/test configuration change, recorded here.
