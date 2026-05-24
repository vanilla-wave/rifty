# ADR 0001: Monorepo on pnpm workspaces

Status: Accepted
Date: 2026-05

## Context

rifty is a layered system (vfs → kernel → runtimes → shell/network → playground) where each layer needs to evolve at its own pace but share types and tooling.

## Decision

Use a pnpm workspace with packages under `packages/*`, apps under `apps/*`, internal tools under `tools/*`, tests in `tests/`, and fixtures under `examples/`.

- `pnpm` for content-addressable installs and fast cold installs of many small packages.
- TypeScript strict project-wide, configured via a shared `tsconfig.base.json`.
- Biome for lint + format (single-tool, fast, no eslint+prettier+stylelint matrix).
- Vitest workspace projects for unit / conformance / integration / parity.
- Playwright with three engine projects for cross-browser e2e (D-006).

## Consequences

- All packages share a single lockfile; deduplication is automatic.
- Internal cross-package imports use `workspace:*` and resolve via `src/index.ts` only.
- Refactors that touch many packages stay atomic in one PR.
- CI installs once per workflow run.
