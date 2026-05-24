# ADR 0018: Expanded `@rifty/runtime-js` public surface via subpath exports

Status: Accepted
Date: 2026-05

## Context

`packages/runtime-js/package.json` was extended with four subpath exports to support real Vite's bootstrap path:

- `./builtins/process`
- `./builtins/timers`
- `./builtins/buffer`
- `./builtins/module`

These are consumed by `apps/playground/src/adapters/realVite.ts` to install Node-shape globals (`globalThis.process`, `globalThis.Buffer`, `globalThis.setImmediate`, `require` for CommonJS interop) on the page realm before Vite loads.

OPEN_QUESTIONS entry Q-2026-05-23-005 had two options:

- A — ship the subpath exports as listed (the path taken).
- B — consolidate the same surface under a single `./host` entry (`@rifty/runtime-js/host`).

Option A was shipped without a stop-and-PR cycle, which violates CLAUDE.md's IRREVERSIBLE-decision rule (rule 1 of the Reversibility checklist: "touches public API between packages"). REVIEW_ACTIONS entry A-010 calls out the workflow violation.

## Decision

Ratify Option A retroactively.

- The four subpath exports stay in `packages/runtime-js/package.json` and become a stable part of the package's public API.
- The workflow violation is acknowledged as a defect of process; the technical decision is accepted because reverting would break the working real-Vite demo and the alternative (Option B) is a cosmetic improvement, not a correctness one.
- Path B (consolidated `./host` entry) remains available for the next public-API review. If `./host` is adopted later, the subpath exports listed here are kept as aliases for one minor version, then removed in a subsequent breaking release.
- Q-2026-05-23-005 moves to the "Promoted" section of `OPEN_QUESTIONS.md` with this ADR as the resolution.

## Consequences

- `@rifty/runtime-js`'s public API is wider than `index.ts + worker + loader + env/capabilities + builtins`. Breaking changes inside `builtins/process|timers|buffer|module` propagate to consumers (today only `apps/playground`, but the surface is committed).
- The real-Vite demo path keeps working without churn.
- Negative: more surface to keep stable. Tests for each subpath should pin the exported symbols.
- Negative: the precedent — shipping an IRREVERSIBLE change without the prescribed stop — is documented but not punished, which weakens the rule slightly. Future reviewers should treat this ADR as a one-off, not a template.
- Follow-up: revisit at the next public-API review; decide whether to consolidate under `./host`.

## Acceptance criteria

- [ ] The four subpath exports remain present in `packages/runtime-js/package.json` and resolve from a fresh install.
- [ ] A test in `packages/runtime-js/tests/` pins the exported symbols of each subpath so accidental removal fails CI.
- [ ] Q-2026-05-23-005 status updated in `OPEN_QUESTIONS.md` referencing this ADR.
