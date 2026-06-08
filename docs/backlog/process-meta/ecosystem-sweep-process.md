---
area: process-meta
status: parked
title: Ecosystem Sweep — quarterly checklist + cron-issue (docs/processes/ecosystem-sweep.md)
created: 2026-06-08
why: D-005/ADR-0006 define a recurring quarterly maintenance process with a named checklist file, but docs/processes/ecosystem-sweep.md does not exist — an uncaptured standing task
sources: [D-005, ADR-0006, PROJECT_PLAN §"Process: Ecosystem Sweep"]
---
## Context
D-005 (ADR-0006) mandates a quarterly "Ecosystem Sweep": (1) re-check the documented-incompatible packages list (`docs/public/compat/incompatible-packages.md`) for new WASM/upstream-WASI builds; (2) refresh `unenv` + `e18e/module-replacements` to fresh versions and run parity tests for regressions. CLAUDE.md says it is "recorded in `docs/processes/ecosystem-sweep.md` as a checklist, executed manually or via cron-issue in GitHub." That file and the cron-issue do not exist; the process is currently fictional.

## Options / Next
Create `docs/processes/ecosystem-sweep.md` as a runnable checklist: (a) diff documented-incompatible list vs latest upstream WASM/WASI availability; (b) bump unenv + e18e/module-replacements, run parity suite, record regressions in compat-matrix. Then either schedule a GitHub cron-issue (scheduled workflow opening a tracking issue quarterly) or fold the cadence into the milestone-review ritual. Parked: no dependency has hit a documented-incompatible wall yet (unenv still deferred-on-trigger per ADR-0015), so the sweep has nothing to sweep — activate when the first WASM-substitution candidate (sqlite/bcrypt/sharp) becomes load-bearing.

## Reversibility
REVERSIBLE — a doc + optional scheduled workflow. No package API touched. Adopting unenv/e18e as actual deps (when the sweep first acts) is IRREVERSIBLE and gets its own ADR then.
