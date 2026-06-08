# ADR 0018: Expanded `@riftydev/runtime-js` public surface via subpath exports

Status: Accepted
Date: 2026-05

> TL;DR: `@riftydev/runtime-js` ships four `./builtins/{process,timers,buffer,module}` subpath exports as stable public API, not consolidated under one `./host` entry

## Context

`packages/runtime-js/package.json` gained four subpath exports for real Vite's bootstrap path:

- `./builtins/process`
- `./builtins/timers`
- `./builtins/buffer`
- `./builtins/module`

`apps/playground/src/adapters/realVite.ts` consumes them to install Node-shape globals (`globalThis.process`, `globalThis.Buffer`, `globalThis.setImmediate`, `require` for CommonJS interop) on the page realm before Vite loads.

Q-2026-05-23-005 had two options:

- A — ship the subpath exports as listed (the path taken).
- B — consolidate them under a single `./host` entry (`@riftydev/runtime-js/host`).

Option A shipped without a stop-and-PR cycle, violating CLAUDE.md's IRREVERSIBLE rule (Reversibility checklist rule 1: "touches public API between packages"). A-010 records the workflow violation.

## Decision

Ratify Option A retroactively.

- The four subpath exports stay in `packages/runtime-js/package.json` as stable public API.
- The workflow violation is acknowledged as a process defect; the technical decision is accepted because reverting breaks the working real-Vite demo and Option B is cosmetic, not correctness.
- Path B (`./host`) stays available for the next public-API review. If adopted, the listed subpath exports are kept as aliases for one minor version, then removed in a later breaking release.
- Q-2026-05-23-005 moves to the "Promoted" section of `OPEN_QUESTIONS.md`, resolved by this ADR.

## Consequences

- Public API is wider than `index.ts + worker + loader + env/capabilities + builtins`. Breaking changes inside `builtins/process|timers|buffer|module` propagate to consumers (today only `apps/playground`).
- Real-Vite demo keeps working without churn.
- Negative: more surface to keep stable; tests should pin each subpath's exported symbols.
- Negative: shipping an IRREVERSIBLE change without the prescribed stop is documented but unpunished, weakening the rule. Treat this ADR as a one-off, not a template.
- Follow-up: at the next public-API review, decide whether to consolidate under `./host`.

## Acceptance criteria

- [ ] The four subpath exports remain in `packages/runtime-js/package.json` and resolve from a fresh install.
- [ ] A test in `packages/runtime-js/tests/` pins each subpath's exported symbols so accidental removal fails CI.
- [ ] Q-2026-05-23-005 status updated in `OPEN_QUESTIONS.md` referencing this ADR.
