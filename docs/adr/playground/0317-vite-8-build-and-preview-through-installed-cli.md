# ADR 0317: Vite 8 build and preview through installed CLI

Status: Accepted
Date: 2026-07-25

> TL;DR: Exact Vite 8.0.16 uses its installed CLI for real Rolldown-WASI
> build and preview; its esbuild plan stays empty, HMR stays off, and broader
> Vite 8 surfaces remain unclaimed.

## Context

ADR-0173 kept Vite 8 build/preview loud while its Rolldown WASI pthread path
was unreliable. ADR-0174 later made the installed `.bin/vite` the one command
path, and the runtime fixes behind ADR-0162 removed the observed child-realm
failure. The #170 cutover contract therefore required a fresh browser
observation instead of preserving the old rejection assumption.

The production-composition browser contract now cold-installs Vite 8.0.16,
runs the installed CLI, emits and executes a hashed `dist` asset, serves it
through the routed preview source, and observes zero esbuild package, asset, or
runtime activation. No Vite-8-specific runtime branch is needed.

## Decision

1. The opt-in exact Vite 8.0.16 template supports `vite build` and
   `vite preview` through the existing installed-CLI child lifecycle.
2. Acceptance requires a real hashed Rolldown bundle, built-module execution,
   routed preview iframe render, and an empty esbuild plan observed in one cold
   Chromium scenario.
3. Vite 8 remains opt-in. ADR-0161's HMR-off policy stands; `vite optimize`,
   other Vite versions, and broader config/plugin parity are not widened by
   this decision.
4. ADR-0173's Vite-8 loud-reject clause and the provisional
   `vite8-production-build-preview` item are retired. Vite 7 remains the
   default and keeps its separate Rollup/esbuild contract.

## Consequences

- (+) Vite 8 users can produce and preview a real production bundle instead
  of hitting a stale rifty-side rejection.
- (+) One generic installed-CLI path owns Vite 7, Vite 8, and non-Vite server
  commands; this adds no dependency, transport, scheduler, or runtime facade.
- (=) The claim is deliberately exact and test-backed: Vite 8.0.16
  dev/build/preview plus esbuild isolation. HMR and unproven command/config
  surfaces remain outside it.
