---
area: runtime-js
status: draft
title: node:test built-in runner
created: 2026-06-12
why: package-authored test suites increasingly use node:test, but a runner commits to scheduling, reporter, mock, and TestContext semantics; keep that contract separate from the minimal vm subset
user_story: As a dev running a package's `node:test` suite (nested tests, skip/todo/only, `TestContext`, mocking), I want it to execute — but today `node:test` is unregistered so any `import 'node:test'` fails.
sources: [docs/research/open-webcontainers-alternative-2026-06.md]
code: [packages/runtime-js/src/builtins/index.ts]
---

## Context

`node:vm` now has the executable subset needed by config loaders and template engines. `node:test`
remains unregistered. A useful runner is more than a loud-stub replacement: it needs nested tests,
async failure accounting, skip/todo/only handling, reporter output, mocking, and `TestContext`
helpers that real package suites depend on.

## Options or Next

- Gate: a target package suite that fails only because `node:test` is missing.
- Then: implement the smallest runner that passes that suite plus Node parity/conformance cases for
  the surfaced behavior.
- Keep unsupported runner features loud via `NotImplementedError`.

## Reversibility

REVERSIBLE while unimplemented. Registering a compatibility-claimed runner should be tested as its
own feature slice.
