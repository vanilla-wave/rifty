# ADR 0006: Shadow registry — layered strategy with ecosystem leverage (D-005)

Status: Accepted
Date: 2026-05

> TL;DR: Native/incompatible pkgs are swapped at resolver time via a layered shadow table (`overrides`→`unenv`→`e18e`→WASM→in-tree adapters), parity-gated

## Decision (D-005)

Substitute native and incompatible packages at the module-resolver level. Substitution sources are layered to reuse existing ecosystem solutions before writing our own.

## Substitution sources (in priority order)

1. User `package.json` `overrides` — standard npm/yarn/pnpm format; no rifty-specific dialect.
2. `unenv` (UnJS) — base polyfill layer for stdlib (`crypto`, `os`, `tty`, `perf_hooks`, `process`); proven in Cloudflare Workers and esm.sh.
3. `e18e/module-replacements` — curated legacy-npm → modern-API substitutions.
4. Existing WASM rebuilds — `@sqlite.org/sqlite-wasm`, `@jsquash/*`, etc.
5. In-tree adapters under `tools/shadow-registry/packages/*` — only to adapt APIs over existing WASM where the ecosystem hasn't.
6. Documented incompatibility — `docs/compat/incompatible-packages.md`, surfaced as a clear install-time error.

## Mechanism

Resolver (D-003) consults the shadow table before `node_modules`. Every substitution must pass parity tests against the substitute's claimed API surface.

> Correction 2026-08-23 — the "a flag disables it for debugging" clause is
> withdrawn (refine verdict, user-signed): every substituted package is native
> and cannot run in-browser regardless, so behavioral comparison lives in the
> Node parity oracles; SCSS comparison exists via unsubstituted pure-JS `sass`;
> an install-artifact audit does not justify a public surface. Per-package user
> override remains the escape hatch. See `docs/adr/README.md` §Declined
> concepts.

## Process

Quarterly "Ecosystem Sweep": re-check `incompatible-packages.md` against new WASM ports, bump `unenv` / `e18e/module-replacements`, run parity regression suite. Tracked in `docs/processes/ecosystem-sweep.md`.

## Consequences

- `.node` native bindings will never load in the browser — a fundamental limit, not a patchable bug.
