---
kind: epic
status: draft
title: Popular native-backed packages through the shadow registry
created: 2026-07-17
value: Popular real-world Node and Vite projects run in the browser because their native-backed dependencies have explicit parity-proven shadow substitutions
user_story: As a browser-IDE user, I want commonly used packages with native internals to work faithfully after npm install, but today each unsupported binary binding stops an otherwise browser-compatible project
items: [npm-client/sass-embedded-substitution]
---

## Context

The completed honest shadow-substitution work delivered the generic runtime-
asset plane and one production proof: esbuild for Vite 7. Broader package
coverage is a distinct user-value outcome, not evidence required to make
esbuild delivery honest. This epic reuses that landed plane and proof rather
than creating a second manager, store, or protocol.

Each child names one real package/version and one real program that consumes it.
It first proves the package-facing API, lifecycle, errors, and output against a
native Node oracle, then chooses an honest pattern:

- upstream pure-JS/WASM twin with no heavy runtime assets; or
- package-specific derived runtime adapter plus declared assets delivered by
  ADR-0249's manager.

Catalog data never substitutes for executable adaptation. Unsupported versions
and surfaces stay named `NotImplementedError` + compat ❌. Initial candidate:
`sass-embedded` in a real Vite SCSS project. Add no package from popularity
alone; selection needs a reproduced user blocker and a viable parity oracle.

Path to ready: name a finite first wave from compatibility evidence, refine
each child to `ready`, and define one end-to-end project journey proving the
wave without turning the epic into an open-ended package wishlist.
