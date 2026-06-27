---
area: runtime-wasi
status: draft
title: Preserve non-fatal esbuild transform warnings
created: 2026-06-26
why: dev esbuild bridge throws on successful transforms that emit stderr warnings and returns warnings as empty.
user_story: As a Vite-template user, I want code with esbuild warnings to compile while surfacing warnings, but today rifty aborts successful transforms when stderr is non-empty.
sources: [PR76 review C2]
code: [apps/playground/src/workers/esbuild-wasi-transform.ts, tools/shadow-registry/src/esbuild-transform.ts]
---

## Context

The playground dev esbuild bridge treats any non-empty stderr after a zero exit as `NotImplementedError('esbuild.transform.warnings')` and hardcodes `warnings: []`. Real esbuild/Vite treat warnings as non-fatal. The shadow-registry build bridge already collects warnings without throwing.

## Options or Next

Mirror the shadow-registry warning collection shape for the dev bridge: parse/collect successful warnings, return them in the transform result, and keep throwing only for failed exits. Add a regression with a transform that emits a warning and still returns code.

## Reversibility

REVERSIBLE — behavior correction in the playground dev bridge, recorded here.
