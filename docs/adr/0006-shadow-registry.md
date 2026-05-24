# ADR 0006: Shadow registry — layered strategy with ecosystem leverage (D-005)

Status: Accepted
Date: 2026-05

Summary of decision D-005. Native and incompatible packages are substituted at the module resolver level. Substitution sources are layered to lean on existing ecosystem solutions before writing our own.

## Substitution sources (in order)

1. User `package.json` `overrides` — npm/yarn/pnpm standard format, no rifty-specific dialect.
2. `unenv` (UnJS) — base polyfill layer for stdlib modules (`crypto`, `os`, `tty`, `perf_hooks`, `process`). Production-proven in Cloudflare Workers and esm.sh.
3. `e18e/module-replacements` — curated list of legacy npm → modern API substitutions.
4. Existing WASM rebuilds — `@sqlite.org/sqlite-wasm`, `@jsquash/*`, etc., from the broader ecosystem.
5. In-tree adapters under `tools/shadow-registry/packages/*` — only for API adaptation over existing WASM where the ecosystem hasn't provided one.
6. Documented incompatibility — `docs/compat/incompatible-packages.md`, surfaced as a clear error on attempted install.

## Mechanism

The resolver (D-003) consults the shadow table before searching `node_modules`. A flag disables it for debugging. Every substitution must pass parity tests against the substitute's claimed API surface.

## Process

Quarterly "Ecosystem Sweep" — re-check incompatible-packages.md against newly published WASM ports, bump `unenv` / `e18e/module-replacements`, run parity regression suite. Tracked in `docs/processes/ecosystem-sweep.md`.

## What this won't fix

`.node` native bindings will never load in the browser — that's a fundamental limit, not a bug we can patch.
