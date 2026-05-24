# rifty

Browser-based Node-compatible runtime + WASI runner. Pet project — building a WebContainers-like system from scratch for deep understanding.

## Status

**Active milestone:** M10 (Real Tooling) — see [TASKS.md](./TASKS.md)

See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the master plan and milestone roadmap, [`docs/adr/`](./docs/adr/) for architectural decisions, [`docs/compat/`](./docs/compat/) for what works.

## Quick start

```bash
pnpm install
pnpm dev          # playground at http://localhost:5273
```

## Commands

```bash
pnpm typecheck            # workspace-wide
pnpm lint                 # biome check
pnpm check:deps           # madge circular check

pnpm test                 # unit tests (watch)
pnpm test:run             # unit (single run)
pnpm test:parity          # node parity runner
pnpm test:conformance     # conformance suite
pnpm test:e2e             # playwright (chromium)
pnpm test:e2e:all         # playwright (all engines)
```

## Architecture

Five layers, top-down only — no reverse imports:

```
apps/playground  (UI: editor + term)
shell, terminal, npm-client
runtime-js (Node API), runtime-wasi (WASI)
kernel (processes, scheduling, IPC)
vfs, io, net (+ service-worker)
```

UI framework (SolidJS) is isolated to `apps/playground/**` (D-002).

## Hard rules

See [`CLAUDE.md`](./CLAUDE.md). The short version:

- TDD: tests first, then implementation.
- No `any` in TypeScript.
- No silent stubs — throw `NotImplementedError`.
- Parity tests are the gold standard.
- One change per PR.

## License

MIT (TBD — pet project, not for production).
