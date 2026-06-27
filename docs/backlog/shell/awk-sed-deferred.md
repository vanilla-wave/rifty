---
area: shell
status: draft
title: awk / full sed deferred (NotImplementedError + compat ❌)
created: 2026-06-08
why: awk and full sed are interpreter-class effort; JS-ecosystem ports are emscripten-WASM-only (a vendored binary = IRREVERSIBLE, ADR-0088 Option B)
user_story: As a developer at the rifty shell prompt, I want to run `awk '{print $2}'` or `sed s///` to munge command output, but today both throw `NotImplementedError` and sit at compat ❌.
sources: [Q-2026-06-06-404, adr/shell/0088-coreutils-pure-js-builtins-strategy.md]
---

## Context

Decision: defer. `awk`/full `sed` throw `NotImplementedError` + register compat ❌ (no silent stub) so the agent fails loudly. Full awk/sed only via the deferred uutils-WASM path (sibling of the ripgrep-WASM deferral).

## Options or Next

A pure-JS `sed s///` subset (~80-120 LOC) is an optional later add if a verified need appears (REVERSIBLE). Register ❌ in the compat matrix when the builtin set lands.

## Reversibility

REVERSIBLE for the JS `sed` subset (CHANGELOG-only). The WASM path is IRREVERSIBLE (vendored binary → ADR-0088 Option B).
