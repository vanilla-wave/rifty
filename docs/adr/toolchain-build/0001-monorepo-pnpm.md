# ADR 0001: Monorepo on pnpm workspaces

Status: Accepted
Date: 2026-05

> TL;DR: `pnpm` workspace (`packages/*`/`apps/*`/`tools/*`) with one lockfile, project-wide TS-strict, `Biome` lint+format, `Vitest` + `Playwright` test projects

## Context

rifty is layered (vfs → kernel → runtimes → shell/network → playground); each layer evolves independently but shares types and tooling.

## Decision

pnpm workspace: `packages/*`, apps `apps/*`, internal tools `tools/*`, tests `tests/`, fixtures `examples/`.

- **pnpm** — content-addressable, fast cold installs of many small packages.
- **TypeScript strict** project-wide via shared `tsconfig.base.json`.
- **Biome** — single-tool lint + format (no eslint+prettier+stylelint matrix).
- **Vitest** workspace projects: unit / conformance / integration / parity.
- **Playwright** — three engine projects for cross-browser e2e (D-006).

## Consequences

- Single lockfile across all packages; automatic dedup.
- Cross-package imports use `workspace:*`, resolving via `src/index.ts` only.
- Multi-package refactors stay atomic in one PR.
- CI installs once per workflow run.
