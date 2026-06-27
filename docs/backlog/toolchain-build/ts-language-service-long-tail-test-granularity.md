---
area: toolchain-build
status: draft
title: Split TS language-service long-tail parity tests by feature
created: 2026-06-26
why: one large parity test can pass vacuously for empty result pairs and stops later feature checks on the first failure.
user_story: As a maintainer reviewing TS-LS parity, I want each long-tail feature to fail independently and non-vacuously, but today one test bundles many assertions.
sources: [PR76 review C4, ADR-0166]
code: [packages/ts-language-service/src/long-tail-parity.test.ts, packages/ts-language-service/src/parity.test.ts]
---

## Context

`long-tail-parity.test.ts` covers many `ts.LanguageService` features in one `it()`. Some assertions compare possibly empty result pairs, and the first failure stops later feature parity checks from running.

## Options or Next

Split the long-tail fixture into per-feature `it()` blocks and add non-vacuity guards for every feature that expects observable results. Follow the guard pattern already used in `parity.test.ts`.

## Reversibility

REVERSIBLE — test-structure change only, recorded here.
